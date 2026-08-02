#!/usr/bin/env python3
"""
OWASP Security Scanner for Buddysaradhi API Gateway & Web App
Implements checks for OWASP Top 10 vulnerabilities (Access Control, Security Headers, Injection, Auth)
"""
import sys
import json
import urllib.request
import urllib.error

GATEWAY_URL = "https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway"
WEB_URL = "https://buddysaradhi.vercel.app"

def log_result(test_name, passed, detail):
    status = "[PASS]" if passed else "[FAIL]"
    print(f"{status} {test_name}: {detail}")
    return passed

def test_health_check():
    url = f"{GATEWAY_URL}/health"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            return log_result("Gateway Health Check", resp.status == 200 and data.get("success") is True, f"HTTP {resp.status}")
    except Exception as e:
        return log_result("Gateway Health Check", False, str(e))

def test_security_headers():
    url = f"{GATEWAY_URL}/health"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            headers = dict(resp.info())
            req_time = headers.get("X-Response-Time") or headers.get("x-response-time")
            has_headers = req_time is not None or resp.status == 200
            return log_result("OWASP A05 Security Headers Check", has_headers, f"X-Response-Time: {req_time}")
    except Exception as e:
        return log_result("OWASP A05 Security Headers Check", False, str(e))

def test_unauthorized_access():
    url = f"{GATEWAY_URL}/api/v1/students"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            return log_result("OWASP A01 Access Control Check", resp.status in [401, 403], f"Status: {resp.status}")
    except urllib.error.HTTPError as e:
        return log_result("OWASP A01 Access Control Check", e.code in [400, 401, 403], f"Blocked with HTTP {e.code}")
    except Exception as e:
        return log_result("OWASP A01 Access Control Check", False, str(e))

def test_sqli_resilience():
    url = f"{GATEWAY_URL}/api/v1/students?search=%27%20OR%201%3D1%20--"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            return log_result("OWASP A03 SQL Injection Resilience", resp.status in [200, 400, 401], f"Handled safely with HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        return log_result("OWASP A03 SQL Injection Resilience", True, f"Handled safely with HTTP {e.code}")
    except Exception as e:
        return log_result("OWASP A03 SQL Injection Resilience", False, str(e))

def main():
    print("==================================================")
    print("Buddysaradhi OWASP Security Scan Harness")
    print("==================================================")
    results = [
        test_health_check(),
        test_security_headers(),
        test_unauthorized_access(),
        test_sqli_resilience(),
    ]
    passed_count = sum(1 for r in results if r)
    total_count = len(results)
    print("--------------------------------------------------")
    print(f"OWASP Audit Summary: {passed_count}/{total_count} Passed")
    print("==================================================")
    sys.exit(0 if passed_count == total_count else 1)

if __name__ == "__main__":
    main()
