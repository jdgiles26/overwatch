import { defineConfig } from "vitest/config";
import { tmpdir } from "os";
import { join } from "path";

export default defineConfig({
  test: {
    env: {
      OVERWATCH_DB: ":memory:",
      OVERWATCH_KEY_PATH: join(tmpdir(), "overwatch-test-key.bin"),
    },
  },
});
