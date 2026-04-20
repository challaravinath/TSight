import { SyntaxKind } from 'ts-morph';
import { ParameterInfo } from '../types.js';

export function extractParameter(param: any): ParameterInfo {
  return {
    name: param.getName(),
    type: param.getType().getText(),
    optional: param.hasQuestionToken() || param.hasInitializer(),
    defaultValue: param.getInitializer()?.getText(),
  };
}

export function getVisibility(node: any): 'public' | 'private' | 'protected' {
  if (node.hasModifier?.(SyntaxKind.PrivateKeyword)) return 'private';
  if (node.hasModifier?.(SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
}
