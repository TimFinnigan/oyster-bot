/**
 * Recipe Plugin
 *
 * Generate recipes from a list of ingredients using Claude.
 * - .recipe <ingredients> — generate a recipe using the provided ingredients
 *
 * Supports optional flags:
 *   --vegetarian  Vegetarian recipe
 *   --vegan       Vegan recipe
 *   --quick       30 minutes or less
 *
 * Example: .recipe chicken, rice, garlic --quick
 */

const FLAG_PATTERNS = [
    { flag: "--vegetarian", label: "vegetarian" },
    { flag: "--vegan", label: "vegan" },
    { flag: "--quick", label: "quick (30 minutes or less)" },
  ];
  
  /**
   * Parse flags and clean ingredients text from the raw input string
   */
  function parseInput(input) {
    const flags = [];
  
    let cleaned = input;
    for (const { flag, label } of FLAG_PATTERNS) {
      if (cleaned.includes(flag)) {
        flags.push(label);
        cleaned = cleaned.replace(flag, "");
      }
    }
  
    const ingredients = cleaned.trim().replace(/,+$/, "").trim();
    return { ingredients, flags };
  }
  
  function buildPrompt(ingredients, flags) {
    const constraints =
      flags.length > 0
        ? `\n\nConstraints: ${flags.join(", ")}.`
        : "";
  
    return `You are a practical home cook. Generate a single recipe using primarily these ingredients: ${ingredients}.
  
  You may assume common pantry staples are available (salt, pepper, oil, butter, flour, sugar, garlic, onion, basic spices) without the user needing to list them.${constraints}
  
  Format the response exactly like this:
  
  **[Recipe Name]**
  
  **Ingredients:**
  - [ingredient with quantity]
  - ...
  
  **Instructions:**
  1. [step]
  2. ...
  
  **Tips:** [1-2 optional tips or substitutions]
  
  Keep it practical and achievable for a home cook. Output only the recipe, nothing else.`;
  }
  
  export default {
    name: "recipe",
  
    help: {
      recipe:
        "Generate a recipe from ingredients. Usage: .recipe <ingredients> [--vegetarian] [--vegan] [--quick]",
    },
  
    commands: {
      recipe: async (msg, { sendTyping, reply, claude }) => {
        const input = msg.text.replace(/^\.recipe\s*/i, "").trim();
  
        if (!input) {
          await reply(
            "Please provide ingredients. Example:\n`.recipe chicken, rice, garlic`\n\nOptional flags: `--vegetarian`, `--vegan`, `--quick`"
          );
          return;
        }
  
        const { ingredients, flags } = parseInput(input);
  
        if (!ingredients) {
          await reply(
            "Please provide ingredients. Example:\n`.recipe chicken, rice, garlic`"
          );
          return;
        }
  
        await sendTyping();
  
        try {
          const response = await claude(buildPrompt(ingredients, flags));
          const recipe = response.result || response.content || "Couldn't generate a recipe.";
          await reply(`🍳 ${recipe}`);
        } catch (err) {
          console.error("[recipe] Error generating recipe:", err.message);
          await reply("❌ Couldn't generate a recipe. Try again later.");
        }
      },
    },
  };
  