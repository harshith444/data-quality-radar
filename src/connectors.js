const CONNECTORS = [
  {
    id: "local",
    name: "Local Files",
    mode: "offline",
    status: "ready",
    formats: ["csv", "text"],
    description: "Profiles and cleans local datasets without internet access."
  },
  {
    id: "s3",
    name: "AWS S3",
    mode: "online",
    status: "not_configured",
    formats: ["csv", "parquet", "text"],
    env: ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET"],
    description: "Planned connector for large files in S3 data lakes."
  },
  {
    id: "azure_blob",
    name: "Azure Blob / ADLS",
    mode: "online",
    status: "not_configured",
    formats: ["csv", "parquet", "text"],
    env: ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER"],
    description: "Planned connector for Azure-hosted datasets."
  },
  {
    id: "snowflake",
    name: "Snowflake",
    mode: "online",
    status: "not_configured",
    formats: ["warehouse_table"],
    env: ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USERNAME", "SNOWFLAKE_PASSWORD", "SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA"],
    description: "Planned connector for warehouse profiling and SQL cleaning plans."
  }
];

export function connectorStatuses() {
  return CONNECTORS.map((connector) => {
    const missingEnv = (connector.env || []).filter((key) => !process.env[key]);
    return {
      ...connector,
      status: missingEnv.length ? connector.status : "ready",
      missingEnv
    };
  });
}
