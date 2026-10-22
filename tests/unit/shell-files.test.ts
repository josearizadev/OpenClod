import { describe, expect, it } from 'vitest'
import { shellFileOps } from '../../src/renderer/src/lib/transcript/shell-files'

describe('shellFileOps', () => {
  it.each([
    ['rm notas.txt', [{ op: 'deleted', path: 'notas.txt' }]],
    [
      'rm -f a.txt b.txt',
      [
        { op: 'deleted', path: 'a.txt' },
        { op: 'deleted', path: 'b.txt' }
      ]
    ],
    ['rm -rf dist', [{ op: 'deleted', path: 'dist' }]],
    ['del "C:\\p\\con espacios.txt"', [{ op: 'deleted', path: 'C:\\p\\con espacios.txt' }]],
    ['Remove-Item -Path src/x.ts -Force', [{ op: 'deleted', path: 'src/x.ts' }]],
    ["Remove-Item 'build.log'", [{ op: 'deleted', path: 'build.log' }]],
    ['touch nuevo.md', [{ op: 'created', path: 'nuevo.md' }]],
    ['mv a.txt b.txt', [{ op: 'moved', from: 'a.txt', to: 'b.txt' }]],
    ['git mv src/a.ts src/b.ts', [{ op: 'moved', from: 'src/a.ts', to: 'src/b.ts' }]],
    [
      'Move-Item -Path viejo.txt -Destination nuevo.txt',
      [{ op: 'moved', from: 'viejo.txt', to: 'nuevo.txt' }]
    ]
  ])('acepta %s', (command, expected) => {
    expect(shellFileOps(command)).toEqual(expected)
  })

  it.each([
    'rm *.tmp',
    'rm $FILE',
    'rm a.txt; rm b.txt',
    'rm a.txt && echo ok',
    'cat a.txt | xargs rm',
    'rm a.txt > log',
    'rm `cat lista`',
    'Remove-Item $env:TEMP\\x',
    'mv a.txt',
    'mv a b c',
    'rm',
    'rm .',
    'rm -rf /',
    'Remove-Item C:\\',
    'ls -la',
    'echo rm a.txt',
    'git status',
    'rm "sin cerrar',
    'New-Item -ItemType Directory x',
    'rm (Get-ChildItem)'
  ])('rechaza %s', (command) => {
    expect(shellFileOps(command)).toEqual([])
  })
})
