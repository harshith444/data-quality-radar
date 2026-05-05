const score = document.querySelector("#score");
const status = document.querySelector("#status");
const checks = document.querySelector("#checks");
const recommendations = document.querySelector("#recommendations");
const connectors = document.querySelector("#connectors");
const useCase = document.querySelector("#use-case");
const planButton = document.querySelector("#plan");
const agentOutput = document.querySelector("#agent-output");

planButton.addEventListener("click", loadCleaningPlan);

async function loadReport() {
  const response = await fetch("/api/report");
  const report = await response.json();

  score.textContent = report.score;
  status.textContent = `${report.status.toUpperCase()} - ${report.rowCount} rows scanned`;

  checks.innerHTML = report.checks
    .map(
      (check) => `
        <article class="check">
          <span class="badge ${check.level}">${check.level}</span>
          <h2>${check.name}</h2>
          <p>${check.value}</p>
        </article>
      `
    )
    .join("");

  recommendations.innerHTML = report.recommendations.length
    ? report.recommendations.map((item) => `<li>${item}</li>`).join("")
    : "<li>No urgent fixes. Dataset is healthy.</li>";
}

async function loadCleaningPlan() {
  const planResponse = await fetch("/api/cleaning-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset: "messy_customers", useCase: useCase.value, mode: "balanced" })
  });
  const plan = await planResponse.json();

  plan.recommendedActions = plan.recommendedActions.map((action) => ({
    ...action,
    approved: ["standardize_case", "impute_null", "remove_duplicates", "flag_outliers"].includes(action.type)
  }));

  const previewResponse = await fetch("/api/cleaning-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset: "messy_customers", plan })
  });
  const preview = await previewResponse.json();

  agentOutput.innerHTML = `
    <div class="score-line">
      <strong>${preview.beforeScore}</strong>
      <span>before</span>
      <strong>${preview.afterScore}</strong>
      <span>after</span>
    </div>
    <h3>Suggested Actions</h3>
    <ul>${[...plan.safeAutoFixes, ...plan.recommendedActions].map((action) => `<li><b>${action.type}</b> ${action.column || "dataset"} - ${action.reason}</li>`).join("")}</ul>
    <h3>Next Analysis</h3>
    <ul>${plan.analysisSuggestions.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
}

async function loadConnectors() {
  const response = await fetch("/api/connectors");
  const body = await response.json();
  connectors.innerHTML = body.connectors
    .map((connector) => `<li><b>${connector.name}</b> - ${connector.status} (${connector.formats.join(", ")})</li>`)
    .join("");
}

loadReport();
loadCleaningPlan();
loadConnectors();
