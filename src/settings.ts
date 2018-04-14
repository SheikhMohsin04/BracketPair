import * as vscode from "vscode";
import BracketPair from "./bracketPair";
import ColorMode from "./colorMode";
import GutterIconManager from "./gutterIconManager";

export default class Settings {
    public readonly bracketDecorations: Map<string, vscode.TextEditorDecorationType>;
    public readonly bracketPairs: BracketPair[] = [];
    public readonly colorMode: ColorMode;
    public readonly contextualParsing: boolean;
    public readonly forceIterationColorCycle: boolean;
    public readonly forceUniqueOpeningColor: boolean;
    public readonly prismLanguageID: string;
    public readonly regexNonExact: RegExp;
    public readonly timeOutLength: number;
    public readonly highlightActiveScope: boolean;
    public isDisposed = false;
    private readonly gutterIcons: GutterIconManager;
    private readonly cssElements: string[][];
    private readonly fontFamily: string;

    constructor(
        languageID: string,
        gutterIcons: GutterIconManager,
        documentUri?: vscode.Uri,
    ) {
        this.gutterIcons = gutterIcons;
        this.prismLanguageID = languageID;

        this.fontFamily = vscode.workspace.getConfiguration("editor", documentUri).fontFamily;

        const configuration = vscode.workspace.getConfiguration("bracketPairColorizer", documentUri);
        const activeScopeCSS = configuration.get("activeScopeCSS") as string[];

        if (!Array.isArray(activeScopeCSS)) {
            throw new Error("activeScopeCSS is not an array");
        }

        this.cssElements = activeScopeCSS.map((e) =>
            [e.substring(0, e.indexOf(":")).trim(),
            e.substring(e.indexOf(":") + 1).trim()]);

        this.highlightActiveScope = configuration.get("highlightActiveScope") as boolean;

        if (typeof this.highlightActiveScope !== "boolean") {
            throw new Error("alwaysHighlightActiveScope is not a boolean");
        }

        this.forceUniqueOpeningColor = configuration.get("forceUniqueOpeningColor") as boolean;

        if (typeof this.forceUniqueOpeningColor !== "boolean") {
            throw new Error("forceUniqueOpeningColor is not a boolean");
        }

        this.forceIterationColorCycle = configuration.get("forceIterationColorCycle") as boolean;

        if (typeof this.forceIterationColorCycle !== "boolean") {
            throw new Error("forceIterationColorCycle is not a boolean");
        }

        this.colorMode = (ColorMode as any)[configuration.get("colorMode") as string];

        if (typeof this.colorMode !== "number") {
            throw new Error("colorMode enum could not be parsed");
        }

        this.timeOutLength = configuration.get<number>("timeOut") as number;

        if (typeof this.timeOutLength !== "number") {
            throw new Error("timeOutLength is not a number");
        }

        if (this.colorMode === ColorMode.Consecutive) {
            const consecutiveSettings = configuration.get<[{}]>("consecutivePairColors");

            if (!Array.isArray(consecutiveSettings)) {
                throw new Error("consecutivePairColors is not an array");
            }

            if (consecutiveSettings.length < 3) {
                throw new Error("consecutivePairColors expected at least 3 parameters, actual: "
                    + consecutiveSettings.length);
            }

            const orphanColor = consecutiveSettings[consecutiveSettings.length - 1] as string;
            if (typeof orphanColor !== "string") {
                throw new Error("consecutivePairColors[" + (consecutiveSettings.length - 1) + "] is not a string");
            }

            const colors = consecutiveSettings[consecutiveSettings.length - 2] as string[];
            if (!Array.isArray(colors)) {
                throw new Error("consecutivePairColors[" + (consecutiveSettings.length - 2) + "] is not a string[]");
            }

            consecutiveSettings.slice(0, consecutiveSettings.length - 2).forEach((brackets, index) => {
                if (typeof brackets === "string" || Array.isArray(brackets)) {
                    if (brackets.length !== 2) {
                        throw new Error("consecutivePairColors[" + index + "] requires 2 element, e.g. ['(',')']");
                    }
                    this.bracketPairs.push(new BracketPair(brackets[0], brackets[1], colors, orphanColor));
                    return;
                }

                throw new Error("consecutivePairColors[ " + index + "] should be a string or an array of strings");
            });
        }
        else {
            const independentSettings = configuration.get<[[{}]]>("independentPairColors");

            if (!Array.isArray(independentSettings)) {
                throw new Error("independentPairColors is not an array");
            }

            independentSettings.forEach((innerArray, index) => {
                if (!Array.isArray(innerArray)) {
                    throw new Error("independentPairColors[" + index + "] is not an array");
                }

                const brackets = innerArray[0] as string;
                if (typeof brackets !== "string" && !Array.isArray(brackets)) {
                    throw new Error("independentSettings[" + index + "][0] is not a string or an array of strings");
                }

                if (brackets.length < 2) {
                    throw new Error("independentSettings[" + index + "][0] needs at least 2 elements");
                }

                const colors = innerArray[1] as string[];
                if (!Array.isArray(colors)) {
                    throw new Error("independentSettings[" + index + "][1] is not string[]");
                }

                const orphanColor = innerArray[2] as string;
                if (typeof orphanColor !== "string") {
                    throw new Error("independentSettings[" + index + "][2] is not a string");
                }

                this.bracketPairs.push(new BracketPair(brackets[0], brackets[1], colors, orphanColor));
            });
        }

        this.regexNonExact = this.createRegex(this.bracketPairs, false);
        this.bracketDecorations = this.createBracketDecorations(this.bracketPairs);
    }

    public dispose() {
        if (!this.isDisposed) {
            this.bracketDecorations.forEach((decoration, key) => {
                decoration.dispose();
            });
            this.bracketDecorations.clear();
            this.isDisposed = true;
        }
    }

    public createScopeDecorations(color: string, bracket: string) {
        const gutterIcon = this.gutterIcons.GetIconUri(bracket, color, this.fontFamily);

        const decorationSettings: vscode.DecorationRenderOptions = {
            gutterIconPath: gutterIcon,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        };

        this.cssElements.forEach((element) => {
            decorationSettings[element[0]] = element[1].replace("{color}", color);
        });

        const decoration = vscode.window.createTextEditorDecorationType(decorationSettings);
        return decoration;
    }

    private createRegex(bracketPairs: BracketPair[], exact: boolean): RegExp {
        const escape = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        let regex = "";
        const matches: string[] = [];
        bracketPairs.forEach((bracketPair) => {
            matches.push(bracketPair.openCharacter);
            matches.push(bracketPair.closeCharacter);
        });

        const sortedByLengthMatches = matches.sort((a, b) => b.length - a.length);

        sortedByLengthMatches.forEach((match) => {
            if (regex !== "") {
                regex += "|";
            }

            if (exact) {
                regex += `${escape(match)}`;
            }
            else {
                regex += `${escape(match)}`;
            }
        });
        return new RegExp(regex, !exact ? "g" : undefined);;
    }

    private createBracketDecorations(bracketPairs: BracketPair[]): Map<string, vscode.TextEditorDecorationType> {
        const decorations = new Map<string, vscode.TextEditorDecorationType>();

        for (const bracketPair of bracketPairs) {
            for (const color of bracketPair.colors) {
                const decoration = vscode.window.createTextEditorDecorationType({
                    color, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
                });
                decorations.set(color, decoration);
            }

            const errorDecoration = vscode.window.createTextEditorDecorationType({
                color: bracketPair.orphanColor,
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            });
            decorations.set(bracketPair.orphanColor, errorDecoration);
        }

        return decorations;
    }
}
