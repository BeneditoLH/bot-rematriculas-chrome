# Bot de rematrículas para Chrome

Extensão local para preparar e enviar mensagens pelo WhatsApp Web com fila, prévia e histórico contra reenvios. Base: versão 0.2.2.

## Instalação
1. Baixe o código e abra `chrome://extensions`.
2. Ative o modo do desenvolvedor e carregue a pasta `extensao` sem compactação.
3. Abra o WhatsApp Web, conecte sua conta e recarregue a aba.
4. Abra o painel, importe sua planilha e selecione a aba do WhatsApp.

## Planilha própria
Nenhuma planilha de contatos acompanha este repositório. Crie um XLSX com aba `Contatos` e cabeçalhos: `Enviar?`, `Aluno`, `Responsável`, `WhatsApp`, `Turma de destino`, `Condições de pagamento`, `Mensagem personalizada`, `Observações`, `Condição 2026`. Use Sim/Não na primeira coluna. O celular deve conter DDD e nove dígitos; o país é Brasil.

Na aba `Orientações`, célula B9, informe o modelo com variáveis `{aluno}`, `{responsavel}`, `{turma_destino}`, `{condicao_2026}` e `{condicoes_pagamento}`. Mensagem personalizada substitui o modelo na linha. A campanha do código é 2027.

## Funcionamento e testes
Iniciar / retomar processa os pendentes; pausar impede o próximo envio. O clique e o campo vazio não comprovam entrega/leitura. Fechar o painel interrompe a fila. Mudanças no WhatsApp podem exigir ajustes.

Execute `npm test` com Node.js 20+. Todos os contatos de teste são sintéticos e não devem ser usados para envios reais. Não publique planilhas, históricos ou credenciais.

A distribuição pública inclui testes unitários sem telefones nem dados financeiros. As configurações são marcadores genéricos e precisam ser preenchidas localmente.

## Documentação para desenvolvedores

- [Arquitetura e fluxo de execução](docs/ARQUITETURA.md)
- [Contribuição e validação](CONTRIBUTING.md)
- [Privacidade e armazenamento](PRIVACIDADE.md)

As funções principais possuem comentários no código explicando responsabilidades e limites. JavaScript nativo e APIs de extensão são usados em tempo de execução, sem etapa de compilação. Node.js é necessário apenas para testes.

## Solução de problemas

| Sintoma | Ação |
| --- | --- |
| Aba do WhatsApp não aparece | Abra no mesmo perfil do navegador e atualize a lista de abas. |
| Rascunho diferente | Guarde o texto existente antes de limpar o campo. |
| Atualização não aparece | Recarregue a extensão, a aba WhatsApp e o painel. |
| Tentativa incerta | Confira aquela conversa antes de liberar uma nova tentativa. |

## Licenciamento

Nenhuma licença de redistribuição foi definida nesta publicação. A disponibilidade pública do código não implica concessão de uma licença de software livre.
