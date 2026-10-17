// Timing input for G-T14: a ~40k-row report built by repeating the real report's sheets (DN made unique).
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const wb = XLSX.read(fs.readFileSync(path.join(__dirname, "../../../samples/hourly/nsn-update-output.xlsx")));
const out = XLSX.utils.book_new();
for (const name of wb.SheetNames) {
  if (name === "All") continue;
  const [head, ...body] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
  const big = [head];
  for (let t = 0; t < 16; t++) for (const r of body) big.push(r.map((c, i) => (i === 4 ? `${c}/COPY-${t}` : c)));
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(big), name);
}
fs.writeFileSync(process.argv[2], XLSX.write(out, { type: "buffer", bookType: "xlsx" }));
