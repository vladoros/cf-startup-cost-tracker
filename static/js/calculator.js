// Demo cost calculator: compare usage cost against startup plan credits.
const RATES = {
  workers: {
    includedRequests: 10_000_000, pricePerMillionRequests: 0.3,
    includedCpuMs: 30_000_000, pricePerMillionCpuMs: 0.02,
  },
  kv: {
    includedReads: 10_000_000, pricePerMillionReads: 0.5,
    includedWrites: 1_000_000, pricePerMillionWrites: 5.0,
    includedDeletes: 1_000_000, pricePerMillionDeletes: 5.0,
    includedStorageGB: 1, pricePerGBMonth: 0.5,
  },
  durableObjects: {
    includedRequests: 1_000_000, pricePerMillionRequests: 0.15,
    includedGBs: 400_000, pricePerMillionGBs: 12.5,
    includedRowsRead: 25_000_000_000, pricePerMillionRowsRead: 0.001,
    includedRowsWritten: 50_000_000, pricePerMillionRowsWritten: 1.0,
    includedStorageGB: 5, pricePerGBMonth: 0.2,
  },
  r2: {
    includedStorageGB: 10, pricePerGBMonth: 0.015,
    includedClassA: 1_000_000, pricePerMillionClassA: 4.5,
    includedClassB: 10_000_000, pricePerMillionClassB: 0.36,
  },
  d1: {
    includedRowsRead: 25_000_000_000, pricePerMillionRowsRead: 0.001,
    includedRowsWritten: 50_000_000, pricePerMillionRowsWritten: 1.0,
    includedStorageGB: 5, pricePerGBMonth: 0.75,
  },
  workersAi: { includedNeuronsPerDay: 10_000, pricePerThousandNeurons: 0.011 },
};

// Fallback credit tiers, verified against cloudflare.com/startups/ on 2026-08-01.
const DEFAULT_TIERS = {
  tier3: { label: "Tier 3", annualCredit: 10_000, workersAiCap: 2_500, r2Cap: 10_000 },
  tier2: { label: "Tier 2", annualCredit: 100_000, workersAiCap: 25_000, r2Cap: 10_000 },
  tier1: { label: "Tier 1", annualCredit: 350_000, workersAiCap: 50_000, r2Cap: 10_000 },
};
let TIERS = structuredClone(DEFAULT_TIERS);

// Read tiers baked into the build by the daily scrape; null if absent.
function embeddedTiers() {
  const el = document.getElementById("tiers-data");
  if (!el) return null;
  try {
    const data = JSON.parse(el.textContent);
    if (!data.tiers?.tier3 || !data.tiers?.tier2 || !data.tiers?.tier1) return null;
    return data.tiers;
  } catch {
    return null;
  }
}


function overage(used, included, pricePerUnit, unitSize) {
  return (Math.max(0, used - included) / unitSize) * pricePerUnit;
}

function calcWorkersCost({ requests = 0, cpuMs = 0 } = {}) {
  const r = RATES.workers;
  return overage(requests, r.includedRequests, r.pricePerMillionRequests, 1_000_000)
    + overage(cpuMs, r.includedCpuMs, r.pricePerMillionCpuMs, 1_000_000);
}

function calcKvCost({ reads = 0, writes = 0, deletes = 0, storageGB = 0 } = {}) {
  const r = RATES.kv;
  return overage(reads, r.includedReads, r.pricePerMillionReads, 1_000_000)
    + overage(writes, r.includedWrites, r.pricePerMillionWrites, 1_000_000)
    + overage(deletes, r.includedDeletes, r.pricePerMillionDeletes, 1_000_000)
    + overage(storageGB, r.includedStorageGB, r.pricePerGBMonth, 1);
}

function calcDurableObjectsCost({ requests = 0, gbSeconds = 0, rowsRead = 0, rowsWritten = 0, storageGB = 0 } = {}) {
  const r = RATES.durableObjects;
  return overage(requests, r.includedRequests, r.pricePerMillionRequests, 1_000_000)
    + overage(gbSeconds, r.includedGBs, r.pricePerMillionGBs, 1_000_000)
    + overage(rowsRead, r.includedRowsRead, r.pricePerMillionRowsRead, 1_000_000)
    + overage(rowsWritten, r.includedRowsWritten, r.pricePerMillionRowsWritten, 1_000_000)
    + overage(storageGB, r.includedStorageGB, r.pricePerGBMonth, 1);
}

function calcR2Cost({ storageGB = 0, classAOps = 0, classBOps = 0 } = {}) {
  const r = RATES.r2;
  return overage(storageGB, r.includedStorageGB, r.pricePerGBMonth, 1)
    + overage(classAOps, r.includedClassA, r.pricePerMillionClassA, 1_000_000)
    + overage(classBOps, r.includedClassB, r.pricePerMillionClassB, 1_000_000);
}

function calcD1Cost({ rowsRead = 0, rowsWritten = 0, storageGB = 0 } = {}) {
  const r = RATES.d1;
  return overage(rowsRead, r.includedRowsRead, r.pricePerMillionRowsRead, 1_000_000)
    + overage(rowsWritten, r.includedRowsWritten, r.pricePerMillionRowsWritten, 1_000_000)
    + overage(storageGB, r.includedStorageGB, r.pricePerGBMonth, 1);
}

function calcWorkersAiCost({ neurons = 0, days = 30 } = {}) {
  const r = RATES.workersAi;
  return overage(neurons, r.includedNeuronsPerDay * days, r.pricePerThousandNeurons, 1_000);
}

// Split the tier's credit across products; R2 and Workers AI have their own caps.
function allocateCredits(costs, tier) {
  const alloc = {};
  let remaining = tier.annualCredit;

  const r2Credit = Math.min(costs.r2 ?? 0, tier.r2Cap, remaining);
  alloc.r2 = r2Credit;
  remaining -= r2Credit;

  const workersAiCredit = Math.min(costs.workersAi ?? 0, tier.workersAiCap, remaining);
  alloc.workersAi = workersAiCredit;
  remaining -= workersAiCredit;

  const others = [
    ["workers", costs.workers ?? 0],
    ["kv", costs.kv ?? 0],
    ["durableObjects", costs.durableObjects ?? 0],
    ["d1", costs.d1 ?? 0],
  ];
  const otherTotal = others.reduce((sum, [, cost]) => sum + cost, 0);
  const pool = Math.min(remaining, otherTotal);
  let assigned = 0;
  others.forEach(([name, cost], i) => {
    if (i === others.length - 1) {
      alloc[name] = Math.max(0, pool - assigned);
      return;
    }
    const share = otherTotal === 0 ? 0 : Math.round((cost / otherTotal) * pool * 100) / 100;
    const credit = Math.min(cost, share, Math.max(0, pool - assigned));
    alloc[name] = credit;
    assigned += credit;
  });
  return alloc;
}

function applyCredit(tierKey, costs) {
  const tier = TIERS[tierKey];
  if (!tier) {
    const totalCost = Object.values(costs).reduce((s, c) => s + (c ?? 0), 0);
    return { tier: null, totalCost, totalCredit: 0, netCost: totalCost, pctCreditUsed: 0, allocation: {} };
  }

  const totalCost = Object.values(costs).reduce((s, c) => s + (c ?? 0), 0);
  const allocation = allocateCredits(costs, tier);
  const totalCredit = Object.values(allocation).reduce((s, c) => s + c, 0);

  return {
    tier,
    totalCost,
    totalCredit,
    netCost: totalCost - totalCredit,
    pctCreditUsed: tier.annualCredit === 0 ? 0 : (totalCredit / tier.annualCredit) * 100,
    allocation,
  };
}

function calculateAll(usage, tierKey) {
  const costs = {
    workers: usage.workers ? calcWorkersCost(usage.workers) : 0,
    kv: usage.kv ? calcKvCost(usage.kv) : 0,
    durableObjects: usage.durableObjects ? calcDurableObjectsCost(usage.durableObjects) : 0,
    r2: usage.r2 ? calcR2Cost(usage.r2) : 0,
    d1: usage.d1 ? calcD1Cost(usage.d1) : 0,
    workersAi: usage.workersAi ? calcWorkersAiCost(usage.workersAi) : 0,
  };
  return { costs, ...applyCredit(tierKey, costs) };
}

// Example monthly usage loaded when a plan card is clicked.
const SCENARIOS = {
  tier3: {
    workers: { requests: 50_000_000, cpuMs: 200_000_000 },
    kv: { reads: 100_000_000, writes: 5_000_000, deletes: 500_000, storageGB: 20 },
    durableObjects: { requests: 20_000_000, gbSeconds: 20_000_000, rowsRead: 50_000_000_000, rowsWritten: 100_000_000, storageGB: 30 },
    r2: { storageGB: 500, classAOps: 5_000_000, classBOps: 100_000_000 },
    d1: { rowsRead: 100_000_000_000, rowsWritten: 500_000_000, storageGB: 50 },
    workersAi: { neurons: 1_000_000_000 },
  },
  tier2: {
    workers: { requests: 200_000_000, cpuMs: 800_000_000 },
    kv: { reads: 500_000_000, writes: 30_000_000, deletes: 2_000_000, storageGB: 100 },
    durableObjects: { requests: 80_000_000, gbSeconds: 100_000_000, rowsRead: 200_000_000_000, rowsWritten: 500_000_000, storageGB: 200 },
    r2: { storageGB: 5_000, classAOps: 50_000_000, classBOps: 500_000_000 },
    d1: { rowsRead: 500_000_000_000, rowsWritten: 2_000_000_000, storageGB: 200 },
    workersAi: { neurons: 5_000_000_000 },
  },
  tier1: {
    workers: { requests: 1_000_000_000, cpuMs: 4_000_000_000 },
    kv: { reads: 2_000_000_000, writes: 200_000_000, deletes: 20_000_000, storageGB: 500 },
    durableObjects: { requests: 400_000_000, gbSeconds: 500_000_000, rowsRead: 1_000_000_000_000, rowsWritten: 2_500_000_000, storageGB: 1_000 },
    r2: { storageGB: 25_000, classAOps: 200_000_000, classBOps: 2_000_000_000 },
    d1: { rowsRead: 2_000_000_000_000, rowsWritten: 10_000_000_000, storageGB: 1_000 },
    workersAi: { neurons: 20_000_000_000 },
  },
};

// --- DOM wiring ---

const FIELDS = {
  workers: [["requests", "Requests"], ["cpuMs", "CPU time (ms)"]],
  kv: [["reads", "Reads"], ["writes", "Writes"], ["deletes", "Deletes"], ["storageGB", "Storage (GB)"]],
  durableObjects: [
    ["requests", "Requests"], ["gbSeconds", "GB-seconds"],
    ["rowsRead", "Rows read"], ["rowsWritten", "Rows written"], ["storageGB", "Storage (GB)"],
  ],
  r2: [["storageGB", "Storage (GB)"], ["classAOps", "Class A ops"], ["classBOps", "Class B ops"]],
  d1: [["rowsRead", "Rows read"], ["rowsWritten", "Rows written"], ["storageGB", "Storage (GB)"]],
  workersAi: [["neurons", "Neurons"]],
};

const PRODUCT_LABELS = {
  workers: "Workers",
  kv: "KV",
  durableObjects: "Durable Objects",
  r2: "R2",
  d1: "D1",
  workersAi: "Workers AI",
};

const seedUsage = {};
let usage = structuredClone(seedUsage);
const cardsContainer = document.querySelector("#product-cards");
const tierInputs = document.querySelectorAll('input[name="tier"]');

function selectedTier() {
  return document.querySelector('input[name="tier"]:checked').value;
}

function currentUsage() {
  const result = {};
  for (const product of Object.keys(FIELDS)) {
    result[product] = {};
    for (const [key] of FIELDS[product]) {
      const input = document.querySelector(`[data-product="${product}"][data-field="${key}"]`);
      result[product][key] = Number(input?.value) || 0;
    }
  }
  return result;
}

function render() {
  cardsContainer.innerHTML = "";
  for (const product of Object.keys(FIELDS)) {
    const productUsage = usage[product];
    const card = document.createElement("section");
    card.className = "product-card";
    card.innerHTML = `
      <header>
        <h3>${PRODUCT_LABELS[product]}</h3>
        <div class="product-cost-box">
          <span class="product-cost" data-cost="${product}">$0.00</span>
          <span class="product-credit" data-credit="${product}">$0.00 covered</span>
        </div>
      </header>
      <div class="product-fields">
        ${FIELDS[product]
          .map(([key, label]) => {
            const value = productUsage ? productUsage[key] ?? 0 : "";
            return `
              <label>
                ${label}
                <input type="number" min="0" step="any" data-product="${product}" data-field="${key}" value="${value}">
              </label>`;
          })
          .join("")}
      </div>
    `;
    cardsContainer.appendChild(card);
  }
  cardsContainer.querySelectorAll("input").forEach((input) => input.addEventListener("input", update));
}

function update() {
  const result = calculateAll(currentUsage(), selectedTier());

  for (const [product, cost] of Object.entries(result.costs)) {
    cardsContainer.querySelector(`[data-cost="${product}"]`).textContent = `$${cost.toFixed(2)}`;
    const credit = result.allocation?.[product] ?? 0;
    cardsContainer.querySelector(`[data-credit="${product}"]`).textContent = `$${credit.toFixed(2)} covered`;
  }

  document.querySelector("#total-cost").textContent = `$${result.totalCost.toFixed(2)}`;
  document.querySelector("#total-credit").textContent = `$${result.totalCredit.toFixed(2)}`;
  document.querySelector("#net-cost").textContent = `$${result.netCost.toFixed(2)}`;
  document.querySelector("#pct-used").textContent = `${result.pctCreditUsed.toFixed(1)}%`;
}

function renderTierLabels() {
  tierInputs.forEach((input) => {
    const tier = TIERS[input.value];
    if (!tier) return;
    const price = input.closest(".tier-card").querySelector(".tier-price");
    price.textContent = `$${(tier.annualCredit / 1000).toLocaleString()}k`;
  });
}

function resetUsage() {
  usage = structuredClone(seedUsage);
  render();
  update();
}

function loadScenario(tierKey) {
  usage = structuredClone(SCENARIOS[tierKey] ?? {});
  render();
  renderTierLabels();
  update();
}

document.querySelector("#generated-at").textContent =
  "Enter your usage, or click a plan to load an example.";

tierInputs.forEach((input) => {
  input.addEventListener("change", () => loadScenario(input.value));
  input.addEventListener("click", () => loadScenario(input.value));
});
document.querySelector("#reset-usage")?.addEventListener("click", resetUsage);

const liveTiers = embeddedTiers();
if (liveTiers) TIERS = liveTiers;
loadScenario("tier3");
