import path from "node:path";
import fs from "node:fs";
import { BrowserName } from "../src/browser/browsers";

export interface BrowserBuildConfig {
  versions: string[];
  dockerfilePath: (version: string) => string;
  dockerBuildArgs: (version: string) => Record<string, string>;
}

export const DOCKER_CONTEXT = path.join(__dirname, "..");

export const NODE_VERSION = fs
  .readFileSync(path.join(__dirname, "..", ".nvmrc"), "utf8")
  .trim();

export const BROWSER_CONFIGS: Record<BrowserName, BrowserBuildConfig> = {
  firefox: {
    versions: ["119.0"],
    dockerfilePath: () =>
      path.join(__dirname, "..", "containers", "firefox.Dockerfile"),
    dockerBuildArgs(version) {
      // https://firefox-source-docs.mozilla.org/testing/geckodriver/Support.html
      const GECKODRIVER_COMPATIBILITY: [
        minFirefoxMajorVersion: number,
        geckodriverVersion: string
      ][] = [
        [102, "0.33.0"],
        [91, "0.31.0"],
        [78, "0.30.0"],
        [60, "0.29.1"],
        [57, "0.25.0"],
        [55, "0.20.1"],
        [53, "0.18.0"],
        [52, "0.17.0"],
      ];

      GECKODRIVER_COMPATIBILITY.sort(([a], [b]) => b - a);

      const firefoxMajorVersion = +version.split(".", 1)[0]!;
      const result = GECKODRIVER_COMPATIBILITY.find(
        ([minFirefoxVersion]) => firefoxMajorVersion >= minFirefoxVersion
      );
      const geckodriverVersion = result?.[1];
      if (!geckodriverVersion)
        throw new Error("Could not find compatible geckodriver version");

      return {
        FIREFOX_VERSION: version,
        GECKODRIVER_VERSION: geckodriverVersion,
      };
    },
  },
};