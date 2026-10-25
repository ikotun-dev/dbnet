import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConnectionURL } from "./connection-url.mjs";

test("imports hosted PostgreSQL credentials without losing encoded characters", () => {
  const p = parseConnectionURL(
    "postgresql://user%40team:p%40ss%3A%23%2F%25@db.example.com:6543/app%20data?sslmode=require",
  );
  assert.equal(p.driver, "postgres");
  assert.equal(p.user, "user@team");
  assert.equal(p.password, "p@ss:#/%");
  assert.equal(p.database, "app data");
  assert.equal(p.port, "6543");
  assert.equal(p.tls, true);
  assert.equal(p.tlsMode, "require");
});
test("preserves PostgreSQL and MySQL TLS modes without automatic downgrades", () => {
  for (const driver of ["postgres", "mysql"]) {
    for (const mode of ["require", "verify-ca", "verify-full", "disable"])
      assert.equal(
        parseConnectionURL(`${driver}://u@db.example.com/db?sslmode=${mode}`)
          .tlsMode,
        mode,
      );
  }
  assert.equal(
    parseConnectionURL("mysql://u@db.example.com/db?ssl-mode=REQUIRED").tlsMode,
    "require",
  );
  assert.equal(
    parseConnectionURL("mysql://u@db.example.com/db?ssl-mode=VERIFY_IDENTITY")
      .tlsMode,
    "verify-full",
  );
  assert.equal(
    parseConnectionURL("mysql://u@db.example.com/db?tls=skip-verify").tlsMode,
    "require",
  );
  assert.equal(
    parseConnectionURL("postgres://u@db.example.com/db").tlsMode,
    "verify-full",
  );
  assert.throws(() =>
    parseConnectionURL(
      "postgres://u@db.example.com/db?sslmode=require&ssl-mode=verify-full",
    ),
  );
});
test("defaults ports, handles IPv6 and distinguishes local and hosted TLS", () => {
  assert.equal(parseConnectionURL("mysql://root:pw@localhost/demo").tls, false);
  assert.equal(
    parseConnectionURL("mysql://root:pw@db.example.com/demo").port,
    "3306",
  );
  assert.equal(
    parseConnectionURL("mysql://root:pw@db.example.com/demo").tls,
    true,
  );
  assert.equal(parseConnectionURL("postgres://user@[::1]/demo").host, "::1");
  assert.equal(parseConnectionURL("postgres://user@[::1]/demo").tls, false);
  assert.equal(
    parseConnectionURL("mysql://u@db.example.com/demo?tls=false").tls,
    false,
  );
});
test("rejects ambiguous or unsupported settings without echoing secrets", () => {
  for (const s of [
    "https://u:SECRET@db.example.com/demo",
    "postgres://u:SECRET@db.example.com/db?sslmode=prefer",
    "postgres://u:SECRET@db.example.com/db?sslmode=require&tls=false",
    "mysql://u:SECRET@db.example.com/db?sslcert=path",
    "postgres://u:SECRET@db.example.com/db?sslmode=require&sslmode=disable",
    "mysql://u:SECRET@db.example.com/db#fragment",
    "postgres://u:%XX@db.example.com/db",
  ]) {
    assert.throws(
      () => parseConnectionURL(s),
      (e) => !e.message.includes("SECRET"),
    );
  }
});
