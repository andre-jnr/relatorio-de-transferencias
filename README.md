# Relatório de transferências

Relatório de uma página com as **transferências entre filiais** (NF-e emitidas), com dados ao vivo do SQL Server (SISMOURA) de cada loja.

- **Porta:** 3008. Ela vem de `PORT` no `.env`.
- **Tecnologia:** Python 3.10 ou mais novo, Flask (Waitress no servidor) e `mssql-python` (já traz o driver).
- **Iniciar local:** `Abrir Relatorio.bat` ou `python app.py` → http://localhost:3008
- **Servidor:** `python app.py --producao` (aceita acesso da rede).

## O que a página mostra

- **Filtros:** mês, ano, loja emissora (ou todas) e grupo de produto.
- **Indicadores:** total transferido, notas emitidas, filiais de destino e produtos.
- **Sankey do fluxo:** loja emissora → grupo de produto (7 maiores + "Outros grupos") → filial de destino, com fitas em degradê
  (cor da origem → cor do destino) e brilho animado no sentido do fluxo. Cada loja tem a mesma cor como origem e como destino.
  Passar o mouse mostra valor e % do total; clicar numa loja, grupo ou filial aplica o filtro correspondente.
  Com "reduzir movimento" ligado no sistema, as animações são desligadas.
- **Produtos transferidos:** código, descrição (com o grupo), quantidade (com a unidade) e valor.
- **Notas emitidas:** número da NF, data de emissão, origem → destino (com CFOP) e valor.
- As duas tabelas têm busca, ordenação por coluna e botão **CSV** (abre direto no Excel).

O servidor só busca o mês. Loja, grupo e filial são filtrados no navegador, sem nova consulta.
O botão **Atualizar** ignora o cache (15 minutos) e consulta o banco de novo.

## Regras

| Item | Regra |
|---|---|
| Transferência | `Fiscal_NF` com CFOP 5.152, 5.409, 5.552 ou 5.557 e `Fiscal_NFe.Situacao = 'AUTORIZADA'` |
| Número da NF | `Fiscal_NFe.NF` |
| Data | `Fiscal_NF.Data_Emissao` |
| Valor da nota | `Fiscal_NF.Total_NF` (igual à soma dos itens) |
| Itens | `Fiscal_NF_Produto` (`NF` = `Fiscal_NF.Codigo`) |
| Grupo | `Grupo_Produto` do cadastro da loja emissora, juntado **pela descrição** entre lojas |
| Filial de destino | CNPJ do destinatário → nome em `filiais` de `config/unidades.json` |

Com um grupo escolhido, notas e totais mostram só o valor dos itens desse grupo.
Os nomes de grupo mudam um pouco entre lojas (ex.: "CARNES AUTO SERVIÇO" e "CARNES DE AUTO SERVIÇO") e aparecem separados no filtro.

O CD não emite NF de transferência no próprio banco, por isso fica fora de `LOJAS` (as transferências do CD
estão na planilha do Relatório gerencial). Para incluir uma nova filial de destino, acrescente o CNPJ em `filiais`.

## Onde fica cada coisa

```
app.py                  servidor web (rotas e cache por loja/mês)
painel/config.py        lê .env e config/unidades.json
painel/banco.py         consultas somente leitura (READ UNCOMMITTED, rollback no fim)
painel/relatorio.py     SQL das notas e itens de transferência
config/unidades.json    lojas emissoras, CFOPs e nomes das filiais pelo CNPJ. Sem senhas
web/                    página, CSS e JS. É a única pasta entregue ao navegador
```

## Segurança

- As senhas ficam só no `.env` (fora do git e do navegador). Copie `.env.example` para `.env` e preencha.
- Só são servidas a página e `web/assets`; `.env`, `config/` e o código respondem 404.
- Não tem login: mantenha o acesso restrito à rede interna.
