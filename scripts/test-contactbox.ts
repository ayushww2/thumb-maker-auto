import "dotenv/config";
import { probeContactBoxApi, getContactBoxStatus } from "../src/lib/contactbox";

async function main() {
  const status = getContactBoxStatus();
  console.log("ContactBox config:", {
    baseURL: status.baseURL,
    reasoningModel: status.reasoningModel,
    imageModel: status.imageModel,
    contactboxKey: status.contactboxKey,
    openaiKey: status.openaiKey,
  });

  const probe = await probeContactBoxApi();
  console.log("\nProbe result:", probe);

  if (!probe.ok) {
    console.error(
      "\nFix: create a NEW token at https://api.contactboxtools.me/console",
    );
    console.error(
      "Use the Token Group assigned by your seller, then update CONTACTBOX_API_KEY.",
    );
    process.exit(1);
  }

  console.log("\nContactBox API is working.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
