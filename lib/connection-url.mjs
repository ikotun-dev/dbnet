/** Parse a connection URL locally; never include its contents in error messages.
 * @param {string} input
 */
export function parseConnectionURL(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid PostgreSQL or MySQL connection URL.");
  }
  const driver = {
    "postgres:": "postgres",
    "postgresql:": "postgres",
    "mysql:": "mysql",
  }[url.protocol];
  if (!driver)
    throw new Error("Use a postgres://, postgresql:// or mysql:// URL.");
  if (!url.hostname || !url.username)
    throw new Error("The connection URL must include a host and username.");
  if (url.hash)
    throw new Error(
      "URL fragments are unsupported. Encode a password’s # character as %23.",
    );
  for (const key of url.searchParams.keys()) {
    if (!["sslmode", "ssl-mode", "ssl", "tls"].includes(key))
      throw new Error(
        "This URL has unsupported connection options. Supported options: sslmode, ssl-mode, ssl and tls.",
      );
    if (url.searchParams.getAll(key).length !== 1)
      throw new Error("Repeated connection options are unsupported.");
  }
  const requirements = [];
  for (const [key, raw] of url.searchParams) {
    const v = raw.toLowerCase().replaceAll("_", "-");
    if (key === "sslmode" || key === "ssl-mode") {
      const mode =
        {
          required: "require",
          disabled: "disable",
          "verify-identity": "verify-full",
        }[v] || v;
      if (["disable", "require", "verify-ca", "verify-full"].includes(mode))
        requirements.push(mode);
      else
        throw new Error(
          "Use sslmode=require, verify-ca, verify-full or disable. TLS fallback modes are unsupported.",
        );
    } else {
      if (["true", "1"].includes(v)) requirements.push("verify-full");
      else if (["false", "0"].includes(v)) requirements.push("disable");
      else if (key === "tls" && v === "skip-verify")
        requirements.push("require");
      else throw new Error("The ssl and tls options must be true or false.");
    }
  }
  if (new Set(requirements).size > 1)
    throw new Error("The connection URL contains conflicting TLS options.");
  let user, password, database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("The connection URL contains invalid percent-encoding.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const tlsMode =
    requirements[0] ??
    (["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase())
      ? "disable"
      : "verify-full");
  return {
    id: "",
    driver,
    host,
    port: url.port || (driver === "postgres" ? "5432" : "3306"),
    user,
    password,
    database,
    name: database ? `${database} @ ${host}` : host,
    tls: tlsMode !== "disable",
    tlsMode,
  };
}
