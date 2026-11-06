import test from 'node:test';
import assert from 'node:assert/strict';
import {messagesMatch,normalizeName,phoneNumber,draftDiagnostic} from '../extensao/core.js';
test('Normaliza marcadores de lista',()=>assert(messagesMatch('- Item fictício','• Item fictício')));
test('Preserva divergência de conteúdo',()=>assert(!messagesMatch('Texto A','Texto B')));
test('Preserva números diferentes',()=>assert(!messagesMatch('Quantidade 1','Quantidade 2')));
test('Rejeita telefone vazio',()=>assert.throws(()=>phoneNumber('')));
test('Normaliza nome sintético',()=>assert.equal(normalizeName('  exemplo  '),'EXEMPLO'));
test('Diagnóstico encontra diferença',()=>assert.equal(draftDiagnostic('a','b').matches,false));
