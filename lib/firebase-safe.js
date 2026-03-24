const FIREBASE_UNSAFE_CHARACTER_PATTERN = /[.#$\[\]\/\u0000-\u001F\u007F]/g;
const FIREBASE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

const FIREBASE_UNSAFE_REPLACEMENTS = {
  ".": " ",
  "#": " No ",
  "$": " USD ",
  "[": " ",
  "]": " ",
  "/": " ",
};

function labelFirebaseUnsafeCharacter(character) {
  if (FIREBASE_CONTROL_CHARACTER_PATTERN.test(character)) {
    return "control";
  }

  return character;
}

export function sanitizeFirebaseCompatibleText(value) {
  return String(value ?? "")
    .replace(FIREBASE_UNSAFE_CHARACTER_PATTERN, (character) => FIREBASE_UNSAFE_REPLACEMENTS[character] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getFirebaseUnsafeCharacters(value) {
  const matches = String(value ?? "").match(FIREBASE_UNSAFE_CHARACTER_PATTERN) ?? [];
  const labels = [];
  const seen = new Set();

  for (const match of matches) {
    const label = labelFirebaseUnsafeCharacter(match);

    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    labels.push(label);
  }

  return labels;
}

export function getFirebaseTextWarning(value) {
  const unsafeCharacters = getFirebaseUnsafeCharacters(value);

  if (!unsafeCharacters.length) {
    return null;
  }

  const sanitizedValue = sanitizeFirebaseCompatibleText(value);

  return {
    characters: unsafeCharacters,
    charactersLabel: unsafeCharacters.join(" "),
    sanitizedValue,
  };
}
