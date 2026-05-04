const score = document.querySelector("#score");
const status = document.querySelector("#status");
const checks = document.querySelector("#checks");
const recommendations = document.querySelector("#recommendations");

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

loadReport();
