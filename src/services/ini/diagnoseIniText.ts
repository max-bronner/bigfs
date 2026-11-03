import { Diagnostic, DiagnosticSeverity, Range } from 'vscode';
import { isFragmentPath, parseSageIni } from '../../formats/ini/sageIniParser';
import { findSageIniProblems } from '../../formats/ini/sageIniProblems';
import type { SageIniDocuments } from './sageIniDocuments';
import { getAssetDiagnostics } from './sageIniAssetCheck';

/** Builds the diagnostics of one file from its text; assets are checked when their names are given */
export const diagnoseIniText = (
  text: string,
  path: string,
  schema: Awaited<ReturnType<SageIniDocuments['getSchema']>>,
  assetNames?: Set<string>,
): Diagnostic[] => {
  const lines = text.split(/\r?\n/);
  const parsed = parseSageIni(lines, schema, {
    isFragment: isFragmentPath(path),
  });

  const assets = assetNames
    ? getAssetDiagnostics(parsed, assetNames, 'bigFS validation')
    : [];

  return findSageIniProblems(parsed, schema)
    .map(({ line, start, end, message, severity }) => {
      const diagnostic = new Diagnostic(
        new Range(line, start, line, end ?? lines[line]?.length ?? start),
        message,
        severity === 'error'
          ? DiagnosticSeverity.Error
          : severity === 'hint'
            ? DiagnosticSeverity.Information
            : DiagnosticSeverity.Warning,
      );

      diagnostic.source = 'bigFS validation';

      return diagnostic;
    })
    .concat(assets);
};
