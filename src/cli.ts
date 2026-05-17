#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./config/setup.js";
import { pockedioVersion } from "./index.js";
import { importTaste } from "./taste/importTaste.js";

function printScaffoldMessage(commandName: string): void {
  console.log(`Pockedio ${commandName} is wired; implementation continues in the next task.`);
}

const program = new Command();

program
  .name("pockedio")
  .description("CLI-first personal AI music radio")
  .version(pockedioVersion)
  .action(() => {
    printScaffoldMessage("session");
  });

program
  .command("setup")
  .description("Configure local Pockedio integrations and memory")
  .action(async () => {
    await runSetup();
  });

program
  .command("import-taste")
  .description("Import normalized music taste data")
  .argument("<file>", "normalized taste CSV file")
  .action((file: string) => {
    const result = importTaste(file);
    console.log(`Imported ${result.trackCount} tracks into ${result.tastePath}.`);
    console.log(`Artists: ${result.artists.join(", ") || "none"}`);
    console.log(`Playlists: ${result.playlists.join(", ") || "none"}`);
  });

program
  .command("serve")
  .description("Run scheduled DJ jobs and mood checks")
  .option("--run-once <job>", "run one implementation test job")
  .action(() => {
    printScaffoldMessage("serve");
  });

program
  .command("status")
  .description("Show Pockedio health and runtime status")
  .action(() => {
    printScaffoldMessage("status");
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
