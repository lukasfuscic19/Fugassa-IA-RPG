const { createSave, deleteSave, listSaves, setActiveSave, getActiveSave, ensureBaseDirs } = require("./saveManager");
const readline = require("readline");
const { spawn } = require("child_process");

ensureBaseDirs();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function startWebUi() {
  const child = spawn("node", ["server.js"], { stdio: "inherit", shell: true });
  child.on("exit", () => process.exit(0));
}

function menu() {
  console.log("\nAI RPG Launcher");
  console.log("1) New Game");
  console.log("2) Continue Game");
  console.log("3) Delete Game");
  console.log("4) Start WebUI");
  console.log("5) Exit");
  console.log(`Active save: ${getActiveSave() || "None"}`);

  rl.question("> ", (answer) => {
    if (answer === "1") {
      rl.question("Game name: ", (name) => {
        try {
          const created = createSave(name);
          console.log(`Created save: ${created}`);
        } catch (err) {
          console.log(`Error: ${err.message}`);
        }
        menu();
      });
    } else if (answer === "2") {
      const saves = listSaves();
      if (!saves.length) {
        console.log("No saves found.");
        return menu();
      }
      saves.forEach((save, index) => console.log(`${index + 1}) ${save}`));
      rl.question("Select save: ", (index) => {
        const selected = saves[Number(index) - 1];
        if (!selected) {
          console.log("Invalid selection.");
          return menu();
        }
        setActiveSave(selected);
        console.log(`Loaded save: ${selected}`);
        menu();
      });
    } else if (answer === "3") {
      const saves = listSaves();
      if (!saves.length) {
        console.log("No saves found.");
        return menu();
      }
      saves.forEach((save, index) => console.log(`${index + 1}) ${save}`));
      rl.question("Delete which save: ", (index) => {
        const selected = saves[Number(index) - 1];
        if (!selected) {
          console.log("Invalid selection.");
          return menu();
        }
        rl.question(`Really delete "${selected}"? (y/n): `, (confirm) => {
          if (confirm.toLowerCase() === "y") {
            try {
              deleteSave(selected);
              console.log("Save deleted.");
            } catch (err) {
              console.log(`Error: ${err.message}`);
            }
          }
          menu();
        });
      });
    } else if (answer === "4") {
      rl.close();
      startWebUi();
    } else {
      rl.close();
    }
  });
}

menu();
