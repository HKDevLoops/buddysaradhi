const { createStudent } = require("./apps/web/src/server/actions/students.ts");

async function main() {
  console.log("Testing createStudent action...");
  const res = await createStudent({
    name: "Test Student",
    phone: "9988776655",
    batch: "Mathematics",
    joined_at: new Date().toISOString(),
    fee_model: "postpaid",
    baseFee: 1500
  }, "Mathematics");
  console.log("createStudent result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
