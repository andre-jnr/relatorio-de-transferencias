"""Consultas das NFs de transferência emitidas por uma loja no mês.

Regras:
- Transferência = Fiscal_NF com CFOP em cfops_transferencia (unidades.json) e NFe AUTORIZADA.
- Número da NF = Fiscal_NFe.NF; data = Fiscal_NF.Data_Emissao; valor = Fiscal_NF.Total_NF.
- Itens em Fiscal_NF_Produto (NF -> Fiscal_NF.Codigo); a soma dos itens bate com o Total_NF.
- Grupo = Grupo_Produto do cadastro da loja emissora (os códigos de grupo mudam entre lojas,
  por isso o navegador junta os grupos pela descrição).
- Filial de destino = CNPJ do destinatário (filiais em unidades.json); fora da lista, o nome da nota.
"""
import re
from datetime import date

from .banco import consultar_varios, num
from .config import CFOPS, FILIAIS

_FILTRO = f"""
    nf.CFOP IN ({",".join("'" + c + "'" for c in CFOPS)})
    AND nf.Data_Emissao >= ? AND nf.Data_Emissao < ?
    AND EXISTS (SELECT 1 FROM Fiscal_NFe e WHERE e.Codigo_Fiscal_NF = nf.Codigo AND e.Situacao = 'AUTORIZADA')
"""

SQL_NOTAS = f"""
SELECT nf.Codigo, nf.Data_Emissao, nf.CPF_CGC, nf.Nome, nf.CFOP, nf.Total_NF,
       (SELECT MAX(e.NF) FROM Fiscal_NFe e WHERE e.Codigo_Fiscal_NF = nf.Codigo AND e.Situacao = 'AUTORIZADA') AS Numero
FROM Fiscal_NF nf
WHERE {_FILTRO}
"""

SQL_ITENS = f"""
SELECT i.NF, i.Produto, MAX(i.Descricao) AS Descricao, MAX(i.Unidade) AS Unidade,
       MAX(g.Descricao) AS Grupo, SUM(i.Quantidade) AS Qtde, SUM(i.Total) AS Valor
FROM Fiscal_NF nf
JOIN Fiscal_NF_Produto i ON i.NF = nf.Codigo
LEFT JOIN Produto p ON p.Codigo = i.Produto
LEFT JOIN Grupo_Produto g ON g.Codigo = p.Grupo
WHERE {_FILTRO}
GROUP BY i.NF, i.Produto
"""


def _periodo(ano, mes):
    inicio = date(ano, mes, 1)
    fim = date(ano + 1, 1, 1) if mes == 12 else date(ano, mes + 1, 1)
    return inicio.isoformat(), fim.isoformat()


def destino(cnpj, nome):
    return FILIAIS.get(re.sub(r"\D", "", cnpj or "")) or re.sub(r"\s+", " ", nome or "").strip() or "Sem destinatário"


def transferencias(u, ano, mes):
    """Notas e itens transferidos pela loja u no mês, já no formato do navegador."""
    params = _periodo(ano, mes)
    timeout = u.get("timeout", 30)
    r = consultar_varios({
        "notas": (u, SQL_NOTAS, params, timeout),
        "itens": (u, SQL_ITENS, params, timeout),
    })
    notas = [{
        "id": n["Codigo"],
        "nf": str(n["Numero"] or ""),
        "data": n["Data_Emissao"].date().isoformat() if n["Data_Emissao"] else "",
        "destino": destino(n["CPF_CGC"], n["Nome"]),
        "cfop": n["CFOP"],
        "valor": round(num(n["Total_NF"]), 2),
    } for n in r["notas"]]
    itens = [{
        "nota": i["NF"],
        "codigo": i["Produto"],
        "descricao": (i["Descricao"] or "").strip(),
        "unidade": (i["Unidade"] or "").strip().upper(),
        "grupo": (i["Grupo"] or "SEM GRUPO").strip().upper(),
        "qtde": round(num(i["Qtde"]), 3),
        "valor": round(num(i["Valor"]), 2),
    } for i in r["itens"]]
    return {"loja": u["slug"], "nome": u["nome"], "notas": notas, "itens": itens}
