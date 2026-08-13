import sys
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3000"

def log_result(test_name, passed, details=""):
    status = "PASSED" if passed else "FAILED"
    print(f"[{status}] {test_name}: {details}")
    return {"test": test_name, "status": status, "details": details}

def http_get(path):
    url = BASE_URL + path
    req = urllib.request.Request(url, headers={"User-Agent": "TestSprite-Runner/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 500, str(e)

def http_post(path, data_dict, headers=None):
    url = BASE_URL + path
    headers = headers or {}
    headers["Content-Type"] = "application/json"
    headers["User-Agent"] = "TestSprite-Runner/1.0"
    data = json.dumps(data_dict).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')
    except Exception as e:
        return 500, str(e)

def run_tests():
    results = []
    print("=== TestSprite Verification Suite for BuddySaradhi ===")

    # Test 1: Root & Login Page Reachability
    code, body = http_get("/login")
    results.append(log_result("Screen 0: Login Page Render", code == 200 and "Sign In" in body, f"HTTP {code}"))

    # Test 2: Protected Route Redirect
    code, body = http_get("/dashboard")
    results.append(log_result("Auth Check: Unauthenticated /dashboard redirect", code == 307 or (code == 200 and "/login" in body), f"HTTP {code}"))

    # Test 3: Gateway Static Endpoint /api/v1/releases/latest
    code, body = http_get("/api/v1/releases/latest")
    is_valid_manifest = False
    if code == 200:
        try:
            data = json.loads(body)
            is_valid_manifest = "version" in data and "platforms" in data
        except Exception:
            pass
    results.append(log_result("API Gateway: /api/v1/releases/latest", is_valid_manifest, f"HTTP {code}"))

    # Test 4: Gateway Proxy Unauthenticated API /api/v1/provision
    code, body = http_post("/api/v1/provision", {})
    results.append(log_result("API Gateway: /api/v1/provision Auth Guard", code == 401, f"HTTP {code} - {body[:100]}"))

    # Test 5: Gateway Proxy /api/v1/students (Gateway Fallback Behavior)
    code, body = http_get("/api/v1/students")
    results.append(log_result("API Gateway: /api/v1/students Unreachable Proxy Handling", code in [200, 401, 502, 503], f"HTTP {code}"))

    # Summary JSON
    passed_count = sum(1 for r in results if r["status"] == "PASSED")
    failed_count = sum(1 for r in results if r["status"] == "FAILED")
    print(f"\nSummary: {passed_count} Passed, {failed_count} Failed out of {len(results)} tests.")

    with open("scratch/test_results.json", "w") as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    run_tests()
