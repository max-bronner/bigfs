import { readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// The layer rules of docs/conventions.md, enforced as errors. LEGACY names the
// folders that predate the layers, so an import that climbs back into one is
// refused even though they are gone.

const LAYERS = ["core", "formats", "game", "node", "platform", "services", "features", "webview"];
const LEGACY = ["actions", "binary", "commands", "common", "language", "model", "providers", "tools", "ui", "constants", "extension"];

const listFolders = (path) => {
    try {
        return readdirSync(path, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch {
        return [];
    }
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A relative import that climbs out to one of the named top-level folders */
const climbingTo = (names, message) => ({
    regex: `^(\\.\\./)+(${names.map(escape).join("|")})(/|$)`,
    message,
});

const NODE_BUILTINS = {
    regex: `^(node:.*|(${builtinModules.map(escape).join("|")})(/.*)?)$`,
    message: "Node built-ins belong in src/node.",
};

const VSCODE = {
    name: "vscode",
    message: "Only src/platform, src/services and src/features import vscode.",
};

const restrict = (files, { patterns = [], paths = [] }) => ({
    files,
    rules: {
        "@typescript-eslint/no-restricted-imports": ["error", { paths, patterns }],
    },
});

const below = (layer, allowed, description = allowed.join(", ")) =>
    climbingTo(
        [...LAYERS.filter((name) => !allowed.includes(name)), ...LEGACY],
        `src/${layer} imports only ${description}.`,
    );

const features = listFolders("src/features");
const pages = listFolders("src/webview");

const layerRules = [
    restrict(["src/core/**/*.ts"], {
        paths: [VSCODE],
        patterns: [NODE_BUILTINS, below("core", ["core"], "itself")],
    }),
    restrict(["src/formats/**/*.ts"], {
        paths: [VSCODE],
        patterns: [NODE_BUILTINS, below("formats", ["core", "formats"])],
    }),
    restrict(["src/game/**/*.ts"], {
        paths: [VSCODE],
        patterns: [NODE_BUILTINS, below("game", ["core", "formats", "game"])],
    }),
    restrict(["src/node/**/*.ts"], {
        paths: [VSCODE],
        patterns: [below("node", ["core", "formats", "game", "node"])],
    }),
    restrict(["src/platform/**/*.ts"], {
        patterns: [below("platform", ["core", "platform"])],
    }),
    restrict(["src/services/**/*.ts"], {
        patterns: [climbingTo(["features", "webview"], "src/services never imports features or webview code.")],
    }),
    ...features.map((feature) =>
        restrict([`src/features/${feature}/**/*.ts`], {
            patterns: [
                climbingTo(
                    features.filter((name) => name !== feature),
                    "A feature never imports another feature; move what they share down a layer.",
                ),
                {
                    regex: `^(\\.\\./)+webview/(?!${escape(feature)}/protocol$)`,
                    message: `src/features/${feature} imports only webview/${feature}/protocol from the webview.`,
                },
            ],
        }),
    ),
    ...pages.map((page) =>
        restrict([`src/webview/${page}/**/*.ts`], {
            paths: [VSCODE],
            patterns: [
                NODE_BUILTINS,
                below(`webview/${page}`, ["core", "formats", "game", "webview"], "core, formats, game, webview/shared and its own folder"),
                climbingTo(
                    pages.filter((name) => name !== page && name !== "shared"),
                    `src/webview/${page} imports only webview/shared and its own folder.`,
                ),
            ],
        }),
    ),
];

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        ...typescriptEslint.configs.recommended.rules,

        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
        }],

        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}, ...layerRules];
