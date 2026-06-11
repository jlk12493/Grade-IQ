const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = '794344511782125598';
const BATCH_SIZE = 500;
const PLAYER_DELAY_MS = 2000;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseGemRate(str) {
  if (!str) return null;
  const cleaned = str.toString().replace('%', '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round((num / 100) * 1000) / 1000;
}

function mapSport(cat) {
  if (!cat) return null;
  const c = cat.toLowerCase();
  if (c.includes('baseball')) return 'Baseball';
  if (c.includes('football')) return 'Football';
  if (c.includes('basketball')) return 'Basketball';
  if (c.includes('hockey')) return 'Hockey';
  if (c.includes('tcg') || c.includes('pokemon') || c.includes('magic')) return 'TCG';
  return cat;
}

function buildSetName(sport, year, setName) {
  if (!setName) return null;
  const sportPrefix = sport ? `${sport} Cards` : null;
  if (sportPrefix && year) return `${sportPrefix} ${year} ${setName}`;
  if (sportPrefix) return `${sportPrefix} ${setName}`;
  if (year) return `${year} ${setName}`;
  return setName;
}

function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  
  // GemRate has 2 junk header rows - real headers are on row 2 (index 1)
  // Find the real header row by looking for "Cat" or "Name"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].includes('Cat') && lines[i].includes('Set') && lines[i].includes('Gem Rate')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 1; // fallback to row 2

  const parseRow = (line) => {
    const cols = [];
    let inQuote = false;
    let current = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cols.push(current.trim());
    return cols;
  };

  const headers = parseRow(lines[headerIdx]).map(h => h.toLowerCase().trim());
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    if (cols.length < 3) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });
    rows.push(row);
  }

  return rows;
}

async function upsertBatch(records) {
  const { error } = await sb
    .from('gem_rates')
    .upsert(records, {
      onConflict: 'player,set_name,card_no,parallel',
      ignoreDuplicates: false
    });
  if (error) throw new Error(`Upsert error: ${error.message}`);
}

// ── Discord ──────────────────────────────────────────────────────────────────
async function sendDiscordDM(message) {
  try {
    const BASE = 'https://discordapp.com/api';
    const headers = {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // Open DM channel
    const dmRes = await fetch(`${BASE}/users/@me/channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient_id: DISCORD_USER_ID })
    });
    const dmData = await dmRes.json();
    const channelId = dmData.id;
    if (!channelId) throw new Error(`No channel ID: ${JSON.stringify(dmData)}`);

    // Send message
    await fetch(`${BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: message })
    });

    console.log('Discord DM sent');
  } catch (e) {
    console.error('Discord error:', e.message);
  }
}

// ── Get players from Supabase ────────────────────────────────────────────────
async function getPlayers() {
  const { data, error } = await sb
    .from('gem_rates')
    .select('player')
    .not('player', 'is', null);
  if (error) throw new Error(`Failed to fetch players: ${error.message}`);
  
  // Get distinct single players (no combos like "Aaron Judge/Roger Maris")
  const players = [...new Set(data.map(r => r.player))]
    .filter(p => p && !p.includes('/'))
    .sort();
  
  console.log(`Found ${players.length} distinct players`);
  return players;
}

// ── Download CSV for a player via Playwright ─────────────────────────────────
async function downloadPlayerCSV(browser, playerName) {
  const context = await browser.newContext({
    acceptDownloads: true
  });
  const page = await context.newPage();

  try {
    const url = `https://www.gemrate.com/player?grader=psa&player=${encodeURIComponent(playerName)}`;
    console.log(`  Visiting: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);

    // Find and click the Export to CSV button
    const exportBtn = await page.locator('button:has-text("Export"), button:has-text("CSV"), a:has-text("Export"), a:has-text("CSV")').first();
    
    if (!await exportBtn.isVisible()) {
      throw new Error('Export button not found');
    }

    // Wait for download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      exportBtn.click()
    ]);

    const tmpPath = path.join(os.tmpdir(), `gemrate_${Date.now()}.csv`);
    await download.saveAs(tmpPath);
    const content = fs.readFileSync(tmpPath, 'utf8');
    fs.unlinkSync(tmpPath);

    return content;
  } finally {
    await context.close();
  }
}

// ── Process CSV content into gem_rates records ───────────────────────────────
function processCSV(content, playerName) {
  const rows = parseCSV(content);
  const records = [];

  for (const row of rows) {
    const cat = row['cat'] || row['category'] || '';
    const year = row['year'] || null;
    const setRaw = row['set'] || '';
    const parallel = row['parallel'] || null;
    const cardNo = row['card #'] || row['card#'] || row['cardno'] || null;
    const gemsRaw = row['gems'] || '0';
    const totalRaw = row['total'] || '0';
    const gemRateRaw = row['gem rate'] || row['gemrate'] || '0%';
    const psa_cert = row['recent cert'] || null;

    if (!setRaw || !cardNo) continue;

    const sport = mapSport(cat);
    const setName = buildSetName(sport, year, setRaw);
    const gemRate = parseGemRate(gemRateRaw);
    const gems = parseInt(gemsRaw.replace(/,/g, '')) || 0;
    const total = parseInt(totalRaw.replace(/,/g, '')) || 0;

    if (gemRate === null) continue;

    records.push({
      player: playerName,
      sport,
      year: year ? parseInt(year) : null,
      set_name: setName,
      parallel: parallel || null,
      card_no: cardNo,
      gems,
      total,
      gem_rate: gemRate,
      gem_rate_month: null,
      psa_cert: psa_cert || null,
      last_updated: new Date().toISOString()
    });
  }

  return records;
}

// ── Trigger EV Scanner ───────────────────────────────────────────────────────
async function triggerScanner() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/trigger_ev_scanner`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({})
      }
    );
    console.log(`Scanner trigger: ${res.status}`);
  } catch (e) {
    console.error('Scanner trigger error:', e.message);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🤖 Jarvis GemRate Sync starting...');
  const startTime = Date.now();

  const results = {
    success: [],
    failed: [],
    totalRecords: 0
  };

  let players;
  try {
    players = await getPlayers();
  } catch (e) {
    const msg = `❌ Jarvis GemRate Sync FAILED: Could not fetch players — ${e.message}`;
    console.error(msg);
    await sendDiscordDM(msg);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    console.log(`\n[${i + 1}/${players.length}] Processing: ${player}`);

    try {
      const csvContent = await downloadPlayerCSV(browser, player);
      const records = processCSV(csvContent, player);

      if (records.length === 0) {
        console.log(`  No records parsed for ${player}`);
        results.failed.push(`${player} (no records parsed)`);
        continue;
      }

      // Upsert in batches
      for (let b = 0; b < records.length; b += BATCH_SIZE) {
        const batch = records.slice(b, b + BATCH_SIZE);
        await upsertBatch(batch);
      }

      console.log(`  ✓ ${records.length} records upserted`);
      results.success.push(player);
      results.totalRecords += records.length;

    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      results.failed.push(`${player} (${e.message})`);
    }

    // Respectful delay between players
    if (i < players.length - 1) await sleep(PLAYER_DELAY_MS);
  }

  await browser.close();

  // Trigger scanner
  console.log('\nTriggering EV scanner...');
  await triggerScanner();

  // Build Discord summary
  const elapsed = Math.round((Date.now() - startTime) / 1000 / 60);
  const lines = [
    `🤖 **Jarvis GemRate Sync Complete** (${elapsed} min)`,
    ``,
    `✅ **Success:** ${results.success.length} players | ${results.totalRecords.toLocaleString()} records`,
    `❌ **Failed:** ${results.failed.length} players`,
  ];

  if (results.failed.length > 0) {
    lines.push(``, `**Failed players:**`);
    results.failed.slice(0, 20).forEach(f => lines.push(`• ${f}`));
    if (results.failed.length > 20) lines.push(`• ...and ${results.failed.length - 20} more`);
  }

  lines.push(``, `🔄 EV Scanner triggered — buy signals updating now`);

  const summary = lines.join('\n');
  console.log('\n' + summary);
  await sendDiscordDM(summary);
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await sendDiscordDM(`❌ Jarvis GemRate Sync crashed: ${e.message}`);
  process.exit(1);
});
