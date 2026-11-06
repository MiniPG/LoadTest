# LoadTest

MiniPG(PG-Server, Card-Server) 부하 테스트 스크립트

## 준비

```bash
brew install k6

# PG-Server 레포에서 부하용 가맹점 1000곳 생성 (최초 1회)
docker exec -i pg-mysql mysql -uroot -proot pg < ../PG-Server/scripts/seed-load-merchants.sql
```

Card-Server(8081)와 PG-Server(8080)를 띄운다.

## 시나리오

| 파일 | 내용 |
|---|---|
| scenarios/capacity.js | 용량 측정. 예열 1분 뒤 결제 흐름을 초당 2 → 5 → 10 → 20 → 40회로 올리며 단계마다 30초 증가 + 3분 유지. 거래 목록은 결제의 1/10. 결제 VU 상한은 2000(`MAX_VUS`로 변경). 요청에 step 태그를 붙여 단계별 p99·실패율을 따로 본다 |
| scenarios/baseline.js | 저부하 기준선. 예열 1분 뒤 결제 흐름 초당 2회(생성 → 승인 → 조회, 20%는 부분취소) + 거래 목록 조회 5초에 1회 |

- 요청마다 m_load_0001 ~ m_load_1000 중 하나를 무작위로 사용한다.
- 4xx는 정상 응답으로 보고, 5xx와 타임아웃만 실패로 센다.
- 예열 구간(warmup 시나리오)은 thresholds 집계에서 뺀다. JIT·커넥션 생성으로 첫 요청이 느리기 때문이다.
- constant-arrival-rate로 응답이 늦어져도 요청 속도를 유지한다.

## 실행

```bash
# 스크립트 확인용
k6 run -e DURATION=1m scenarios/baseline.js

# 기준선 측정
k6 run scenarios/baseline.js

# 옵션
k6 run -e BASE_URL=http://<host>:8080 -e RATE=5 -e WARMUP=1m -e DURATION=10m scenarios/baseline.js
```

## AWS 서버에 실행

k6는 내 맥에서 돌리고, AWS의 ALB(pg.on-me-app.com, 내 IP만 허용)를 호출한다.

```bash
# Infra/env
terraform apply

# Infra 루트: 가맹점 시드 (m_test + m_load 1000곳)
./scripts/seed-pg-merchants.sh

# LoadTest
./bin/aws.sh scenarios/baseline.js

# destroy 전에 확인 (모니터링 서버·DB도 함께 지워져 기록이 사라짐) — 아래 "destroy 전 확인" 참고

# 끝나면 반드시 Infra/env에서
terraform destroy
```

- 끝날 때 Grafana에 테스트 구간을 주석(annotation)으로 남긴다. baseline은 예열·측정 구간을 띠로, capacity는 단계 시작마다 세로선으로 표시한다. 터미널에도 같은 시각(KST)을 출력한다.
- 로컬(`BASE_URL`이 없거나 localhost)은 로컬 Grafana(`localhost:3000`, admin/admin)에 자동으로 남긴다. Grafana가 꺼져 있으면 3초 뒤 경고만 남기고 넘어간다.
- AWS는 `bin/aws.sh`로 실행한다. Infra terraform output에서 PG 주소, Grafana 주소·비밀번호를 읽어 그 실행에만 넘긴다(터미널에 export하지 않음).

```bash
./bin/aws.sh scenarios/capacity.js
```

- k6가 잰 시간에는 맥 ↔ ALB 인터넷 왕복과 ALB 처리 시간이 들어간다.
- 서버 처리 시간은 Grafana의 http.server.requests(PG 안에서 잰 시간)로 따로 본다. 두 값의 차이가 네트워크·ALB 몫이다.

## destroy 전 확인

destroy하면 모니터링 서버(Prometheus·Loki·Grafana)와 DB가 함께 지워져, 그래프·로그·데드락 기록을 다시 볼 수 없다.

1. **에러 로그**: Grafana `pg-overview` 로그 줄에서 측정 구간의 ERROR·WARN을 확인한다. 예외가 있으면 스택 트레이스를 저장한다.
2. **데드락**: 로그에 `Deadlock found`가 있으면 PG DB에서 마지막 데드락의 두 트랜잭션과 락을 저장한다.
   ```bash
   aws ssm start-session --target <pg-db 인스턴스 ID>   # Infra/env: terraform output instances
   sudo docker exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW ENGINE INNODB STATUS\G"' \
     | sed -n '/LATEST DETECTED DEADLOCK/,/TRANSACTIONS/p'
   ```
3. **실패 응답**: k6 요약에 실패가 있으면 서버 쪽 5xx와 맞춰 본다. 새로 생긴 `status="500"` 시계열은 `increase()`가 첫 값을 0으로 계산하므로, 개수는 `http_server_requests_seconds_count{status=~"5.."}` 원래 값으로 확인한다.
4. **Grafana 캡처**: 측정 구간으로 시간을 맞추고, 비교할 패널(SLO 달성률, RPS, Tomcat 스레드, 커넥션 사용량·대기·획득 시간, 호스트 CPU, MySQL QPS, 쿼리별 실행 횟수)을 캡처한다.


## JFR 분석

Infra에서 `pg_jfr_enabled = true`로 띄우고 `./scripts/fetch-pg-jfr.sh ../LoadTest/results`로 녹화를 가져온 뒤, 보고 싶은 구간(KST)을 지정해 요약한다. JDK 21 이상 필요.

```bash
java tools/jfr/JfrReport.java results/pg-<시각>.jfr 2026-11-06T10:20:00+09:00 2026-11-06T10:28:30+09:00
```

| 출력 | 뜻 |
|---|---|
| 스택에 포함된 비율 | 호출 경로에 그 패키지가 걸쳐 있는 표본의 비율. 합이 100%를 넘는다 |
| 실제로 CPU를 쓴 라이브러리 | 스택 위에서 처음 나오는 JDK 밖 패키지. `HashMap`처럼 모두가 쓰는 JDK 코드를 건너뛰고 누가 CPU를 태웠는지 본다 |
| 표본이 찍힌 스레드 | 요청 스레드인지 배경 작업인지 |
| MySQL 드라이버 | 드라이버 안에서 돌던 메서드와, 드라이버로 들어온 입구·호출자 |
| 스레드별 CPU | JFR 자기 스레드(`JFR Recorder Thread` 등)의 몫으로 오버헤드를 가늠 |
| 새로 만들어진 스레드 수 | 요청마다 스레드를 새로 만드는 곳이 있는지 |

전체를 한눈에 보려면 `jfr view hot-methods <파일>`, 플레임 그래프는 JDK Mission Control로 연다.
