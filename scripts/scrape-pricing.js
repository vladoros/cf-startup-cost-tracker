// Scrapes the startup-plan page and writes data/tiers.json for the Hugo build.
import https from "https";
import fs from "fs";
import path from "path";

const SOURCE_URL = "https://www.cloudflare.com/startups/";
const OUT = path.join(process.cwd(), "data", "tiers.json");

const FALLBACK_TIERS = {
  tier3: { label: "Tier 3", annualCredit: 10_000, workersAiCap: 2_500, r2Cap: 10_000 },
  tier2: { label: "Tier 2", annualCredit: 100_000, workersAiCap: 25_000, r2Cap: 10_000 },
  tier1: { label: "Tier 1", annualCredit: 350_000, workersAiCap: 50_000, r2Cap: 10_000 },
};

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "user-agent": "cf-startup-cost-tracker (+github pages build)" } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects >= 5) return reject(new Error("too many redirects"));
          return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`fetch ${url} failed: ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function dollarsToNumber(str) {
  return Number(str.replace(/,/g, ""));
}

function parseTierCredit(text, tierNumber) {
  const re = new RegExp(`Tier\\s*${tierNumber}[\\s\\S]{0,80}?\\$(\\d+(?:,\\d{3})*)\\s*k\\b`, "i");
  const match = text.match(re);
  return match ? dollarsToNumber(match[1]) * 1000 : null;
}

function parseR2Cap(text) {
  const match = text.match(/R2[\s\S]{0,150}?\$([\d,]+)\s*cap/i);
  return match ? dollarsToNumber(match[1]) : null;
}

function parseWorkersAiCaps(text) {
  const match = text.match(
    /Workers AI[\s\S]{0,250}?\$([\d,]+)\s*cap for Tier 3[\s\S]{0,60}?\$([\d,]+)[\s\S]{0,30}?Tier 2[\s\S]{0,60}?\$([\d,]+)[\s\S]{0,30}?Tier 1/i,
  );
  if (!match) return null;
  return {
    tier3: dollarsToNumber(match[1]),
    tier2: dollarsToNumber(match[2]),
    tier1: dollarsToNumber(match[3]),
  };
}

async function parseTiers() {
  const text = stripHtml(await get(SOURCE_URL));

  const workersAiCaps = parseWorkersAiCaps(text) ?? {};
  const r2Cap = parseR2Cap(text);

  const tiers = {};
  for (const [key, num] of [["tier3", 3], ["tier2", 2], ["tier1", 1]]) {
    const scrapedCredit = parseTierCredit(text, num);
    tiers[key] = {
      label: FALLBACK_TIERS[key].label,
      annualCredit: scrapedCredit ?? FALLBACK_TIERS[key].annualCredit,
      workersAiCap: workersAiCaps[key] ?? FALLBACK_TIERS[key].workersAiCap,
      r2Cap: r2Cap ?? FALLBACK_TIERS[key].r2Cap,
      source: scrapedCredit ? "scraped" : "fallback",
    };
  }

  return { tiers, sourceUrl: SOURCE_URL, fetchedAt: new Date().toISOString() };
}

async function main() {
  try {
    const body = await parseTiers();
    fs.writeFileSync(OUT, JSON.stringify(body, null, 2));
    console.log(`wrote ${OUT} (scraped)`);
  } catch (err) {
    const body = {
      tiers: FALLBACK_TIERS,
      sourceUrl: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      error: String(err),
    };
    fs.writeFileSync(OUT, JSON.stringify(body, null, 2));
    console.error(`scrape failed, wrote fallback: ${err}`);
  }
}

main();
