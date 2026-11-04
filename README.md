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
| scenarios/baseline.js | 저부하 기준선. 결제 흐름 초당 2회(생성 → 승인 → 조회, 20%는 부분취소) + 거래 목록 조회 5초에 1회 |

- 요청마다 m_load_0001 ~ m_load_1000 중 하나를 무작위로 사용한다.
- 4xx는 정상 응답으로 보고, 5xx와 타임아웃만 실패로 센다.
- constant-arrival-rate로 응답이 늦어져도 요청 속도를 유지한다.

## 실행

```bash
# 스크립트 확인용
k6 run -e DURATION=1m scenarios/baseline.js

# 기준선 측정
k6 run scenarios/baseline.js

# 옵션
k6 run -e BASE_URL=http://<host>:8080 -e RATE=5 -e DURATION=10m scenarios/baseline.js
```
