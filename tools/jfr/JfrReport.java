import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordedFrame;
import jdk.jfr.consumer.RecordedStackTrace;
import jdk.jfr.consumer.RecordedThread;
import jdk.jfr.consumer.RecordingFile;

import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class JfrReport {

    private static final String[][] PACKAGES = {
            {"my-code", "com.sangyunpark99"}, {"spring-aop", "org.springframework.aop"},
            {"spring-tx", "org.springframework.transaction"}, {"spring-data", "org.springframework.data"},
            {"spring-webmvc", "org.springframework.web"}, {"spring-http-client", "org.springframework.http.client"},
            {"hibernate", "org.hibernate"}, {"hikari", "com.zaxxer"}, {"mysql-driver", "com.mysql"},
            {"tomcat", "org.apache"}, {"jackson", "com.fasterxml.jackson"}, {"logback", "ch.qos.logback"},
            {"logstash-encoder", "net.logstash"}, {"micrometer", "io.micrometer"},
            {"jdk-httpclient", "jdk.internal.net.http"}, {"MessageDigest", "java.security.MessageDigest"},
            {"tls", "sun.security.ssl"}, {"jfr", "jdk.jfr"}};

    private final Map<String, Integer> inclusive = new HashMap<>();
    private final Map<String, Integer> owner = new HashMap<>();
    private final Map<String, Integer> sampledThreads = new HashMap<>();
    private final Map<String, Double> threadCpu = new HashMap<>();
    private final Map<String, Integer> driverTop = new HashMap<>();
    private final Map<String, Integer> driverEntry = new HashMap<>();
    private final Map<String, Integer> startedThreads = new HashMap<>();
    private int samples;
    private int driverSamples;

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.out.println("사용: java tools/jfr/JfrReport.java <파일.jfr> <시작> <끝>");
            System.out.println("예:   java tools/jfr/JfrReport.java results/pg.jfr 2026-11-06T10:20:00+09:00 2026-11-06T10:28:30+09:00");
            return;
        }
        Instant from = OffsetDateTime.parse(args[1]).toInstant();
        Instant to = OffsetDateTime.parse(args[2]).toInstant();
        JfrReport report = new JfrReport();
        try (RecordingFile file = new RecordingFile(Path.of(args[0]))) {
            while (file.hasMoreEvents()) {
                RecordedEvent event = file.readEvent();
                Instant time = event.getStartTime();
                if (time.isBefore(from) || time.isAfter(to)) {
                    continue;
                }
                report.accept(event);
            }
        }
        report.print();
    }

    private void accept(RecordedEvent event) {
        switch (event.getEventType().getName()) {
            case "jdk.ExecutionSample" -> acceptSample(event);
            case "jdk.ThreadCPULoad" -> threadCpu.merge(threadGroup(event.getThread()),
                    (double) event.getFloat("user") + event.getFloat("system"), Double::sum);
            case "jdk.ThreadStart" -> startedThreads.merge(threadGroup(event.getThread("thread")), 1, Integer::sum);
            default -> {
            }
        }
    }

    private void acceptSample(RecordedEvent event) {
        samples++;
        sampledThreads.merge(threadGroup(event.getThread("sampledThread")), 1, Integer::sum);
        RecordedStackTrace stackTrace = event.getStackTrace();
        if (stackTrace == null || stackTrace.getFrames().isEmpty()) {
            return;
        }
        List<RecordedFrame> frames = stackTrace.getFrames();
        StringBuilder stack = new StringBuilder();
        for (RecordedFrame frame : frames) {
            stack.append(typeName(frame)).append(' ');
        }
        String joined = stack.toString();
        for (String[] pkg : PACKAGES) {
            if (joined.contains(pkg[1])) {
                inclusive.merge(pkg[0], 1, Integer::sum);
            }
        }
        owner.merge(firstNonJdkPackage(frames), 1, Integer::sum);
        acceptDriver(frames);
    }

    private void acceptDriver(List<RecordedFrame> frames) {
        int first = -1;
        int last = -1;
        for (int i = 0; i < frames.size(); i++) {
            if (typeName(frames.get(i)).startsWith("com.mysql")) {
                if (first < 0) {
                    first = i;
                }
                last = i;
            }
        }
        if (first < 0) {
            return;
        }
        driverSamples++;
        driverTop.merge(method(frames.get(first)), 1, Integer::sum);
        String caller = last + 1 < frames.size() ? method(frames.get(last + 1)) : "-";
        driverEntry.merge(method(frames.get(last)) + "  <-  " + caller, 1, Integer::sum);
    }

    private void print() {
        System.out.printf("CPU 표본: %d개%n", samples);
        section("스택에 포함된 비율 (호출 경로에 걸쳐 있으면 셈, 합이 100%를 넘음)", inclusive, 20);
        section("실제로 CPU를 쓴 라이브러리 (스택 위에서 처음 나오는 JDK 밖 패키지)", owner, 15);
        section("표본이 찍힌 스레드", sampledThreads, 10);
        System.out.printf("%n== MySQL 드라이버: 표본의 %.1f%%%n", percent(driverSamples));
        section("드라이버 안에서 실제로 돌던 메서드", driverTop, 15);
        section("드라이버로 들어온 입구  <-  호출자", driverEntry, 15);
        System.out.println();
        System.out.println("== 스레드별 CPU (jdk.ThreadCPULoad 합, 상대 비교용)");
        threadCpu.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                .limit(12)
                .forEach(e -> System.out.printf("  %8.2f  %s%n", e.getValue(), e.getKey()));
        System.out.println();
        System.out.println("== 새로 만들어진 스레드 수");
        startedThreads.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .limit(10)
                .forEach(e -> System.out.printf("  %8d  %s%n", e.getValue(), e.getKey()));
    }

    private void section(String title, Map<String, Integer> counts, int limit) {
        System.out.println();
        System.out.println("== " + title);
        counts.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .limit(limit)
                .forEach(e -> System.out.printf("  %6d  %5.1f%%  %s%n", e.getValue(), percent(e.getValue()), e.getKey()));
    }

    private double percent(int count) {
        return samples == 0 ? 0 : 100.0 * count / samples;
    }

    private static String firstNonJdkPackage(List<RecordedFrame> frames) {
        for (RecordedFrame frame : frames) {
            String type = typeName(frame);
            if (!type.startsWith("java.") && !type.startsWith("jdk.internal.misc") && !type.startsWith("sun.")) {
                return type.replaceAll("^((?:[^.]+\\.){3}).*", "$1");
            }
        }
        return "(JDK)";
    }

    private static String typeName(RecordedFrame frame) {
        return frame.getMethod().getType().getName();
    }

    private static String method(RecordedFrame frame) {
        return typeName(frame).replace("com.mysql.cj.", "") + "." + frame.getMethod().getName();
    }

    private static String threadGroup(RecordedThread thread) {
        return thread == null ? "?" : String.valueOf(thread.getJavaName()).replaceAll("\\d+", "N");
    }
}
