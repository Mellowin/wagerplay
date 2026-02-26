#!/usr/bin/env python3
"""Advanced security and edge case testing using standard library"""

import http.client
import json
import urllib.parse

BASE_URL = "localhost:3000"

def request(method, path, body=None, headers=None):
    """Make HTTP request"""
    conn = http.client.HTTPConnection("localhost", 3000)
    all_headers = headers or {}
    
    if body and isinstance(body, dict):
        body = json.dumps(body)
        all_headers["Content-Type"] = "application/json"
    
    try:
        conn.request(method, path, body, all_headers)
        resp = conn.getresponse()
        data = resp.read().decode('utf-8', errors='ignore')
        conn.close()
        return resp.status, data
    except Exception as e:
        conn.close()
        return -1, str(e)

def get_guest_token():
    """Create guest and return token"""
    status, data = request("POST", "/auth/guest")
    if status == 201:
        return json.loads(data)["token"]
    return None

def test_sql_injection():
    """Test SQL injection attempts"""
    print("\n=== SQL Injection Tests ===")
    payloads = [
        "test@test.com' OR '1'='1",
        "test@test.com'; DROP TABLE users; --",
        'test@test.com" OR "1"="1',
        "test@test.com' UNION SELECT * FROM users --",
    ]
    
    for payload in payloads:
        status, data = request("POST", "/auth/register", {
            "email": payload,
            "password": "password123"
        })
        print(f"SQLi '{payload[:35]}...': HTTP {status}")

def test_xss():
    """Test XSS payloads"""
    print("\n=== XSS Tests ===")
    token = get_guest_token()
    
    xss_payloads = [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "<body onload=alert(1)>",
    ]
    
    for payload in xss_payloads:
        status, data = request("PATCH", "/auth/profile", 
            {"displayName": payload},
            {"Authorization": f"Bearer {token}"}
        )
        print(f"XSS '{payload[:30]}...': HTTP {status}")

def test_boundary_values():
    """Test boundary values"""
    print("\n=== Boundary Value Tests ===")
    token = get_guest_token()
    
    test_cases = [
        ("displayName", "A" * 1000, "Very long name (1000 chars)"),
        ("displayName", "A" * 20, "Exactly 20 chars"),
        ("displayName", "A" * 21, "21 chars (should fail)"),
    ]
    
    for field, value, desc in test_cases:
        status, data = request("PATCH", "/auth/profile",
            {"displayName": value},
            {"Authorization": f"Bearer {token}"}
        )
        print(f"{desc}: HTTP {status}")

def test_invalid_json():
    """Test malformed JSON"""
    print("\n=== Invalid JSON Tests ===")
    
    invalid_jsons = [
        '{"email": "test@test.com", "password": }',
        '{"email": "test@test.com", }',
        '{invalid json}',
        '',
    ]
    
    for payload in invalid_jsons:
        conn = http.client.HTTPConnection("localhost", 3000)
        try:
            conn.request("POST", "/auth/register", payload, {"Content-Type": "application/json"})
            resp = conn.getresponse()
            print(f"Invalid JSON '{payload[:30]}...': HTTP {resp.status}")
            conn.close()
        except Exception as e:
            print(f"Invalid JSON error: {e}")
            conn.close()

def test_special_characters():
    """Test special characters and unicode"""
    print("\n=== Special Characters Tests ===")
    token = get_guest_token()
    
    special_chars = [
        "🔥🎮👾",  # Emoji
        "中文测试",  # Chinese
        "<>&\"'",  # HTML entities
        "Normal",  # Normal
    ]
    
    for chars in special_chars:
        status, data = request("PATCH", "/auth/profile",
            {"displayName": chars},
            {"Authorization": f"Bearer {token}"}
        )
        print(f"Special chars '{chars[:10]}': HTTP {status}")

def test_authorization_bypass():
    """Test authorization bypass attempts"""
    print("\n=== Authorization Bypass Tests ===")
    
    attempts = [
        ("Empty token", ""),
        ("Invalid format", "invalid_token"),
        ("Bearer lowercase", None),  # Will add token
        ("No header", None),
    ]
    
    token = get_guest_token()
    
    for desc, auth_header in attempts:
        headers = {}
        if desc == "Bearer lowercase":
            headers["Authorization"] = f"bearer {token}"
        elif desc == "No header":
            pass
        elif auth_header:
            headers["Authorization"] = auth_header
            
        status, data = request("GET", "/auth/me", None, headers if headers else None)
        print(f"{desc}: HTTP {status}")

def test_numeric_boundary():
    """Test numeric boundary conditions"""
    print("\n=== Numeric Boundary Tests ===")
    token = get_guest_token()
    
    numeric_tests = [
        ("stakeVp", -1, "Negative stake"),
        ("stakeVp", 0, "Zero stake"),
        ("stakeVp", 999999999999999999, "Huge stake"),
        ("playersCount", 1, "1 player"),
        ("playersCount", 100, "100 players"),
        ("playersCount", -5, "Negative players"),
    ]
    
    for field, value, desc in numeric_tests:
        body = {"playersCount": 2 if field == "stakeVp" else value, 
                "stakeVp": value if field == "stakeVp" else 100}
        status, data = request("POST", "/matchmaking/quickplay",
            body,
            {"Authorization": f"Bearer {token}"}
        )
        print(f"{desc}: HTTP {status}")

if __name__ == "__main__":
    print("Starting advanced security tests...")
    test_sql_injection()
    test_xss()
    test_boundary_values()
    test_invalid_json()
    test_special_characters()
    test_authorization_bypass()
    test_numeric_boundary()
    print("\n=== Tests completed ===")
