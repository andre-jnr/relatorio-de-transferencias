"""Configuração: .env (credenciais e lojas consultadas) + config/unidades.json (lojas e filiais).

Nada daqui é enviado ao navegador, a não ser slug e nome das lojas.
"""
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _ler_env():
    """Carrega o .env da pasta do projeto (sem sobrescrever variáveis já definidas no ambiente)."""
    arq = RAIZ / ".env"
    if not arq.exists():
        return
    for linha in arq.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        os.environ.setdefault(nome.strip(), valor.strip().strip('"').strip("'"))


_ler_env()

CFG = json.loads((RAIZ / "config" / "unidades.json").read_text(encoding="utf-8"))
PORTA = int(os.getenv("PORT", "3008"))
CACHE_MINUTOS = float(os.getenv("CACHE_MINUTOS", "15"))
CFOPS = CFG["cfops_transferencia"]
FILIAIS = CFG["filiais"]

TODAS = {u["slug"]: u for u in CFG["lojas"]}
_pedidas = [s.strip() for s in os.getenv("LOJAS", "").split(",") if s.strip()]
LOJAS = [TODAS[s] for s in _pedidas if s in TODAS]
LOJAS_DESCONHECIDAS = [s for s in _pedidas if s not in TODAS]


def loja(slug):
    """Loja habilitada pelo slug, ou None (loja fora do .env é tratada como inexistente)."""
    return next((u for u in LOJAS if u["slug"] == slug), None)


def credenciais(fonte):
    """Usuário e senha do .env. "credencial": "FLORES" usa FLORES_DB_USUARIO / FLORES_DB_SENHA."""
    prefixo = f"{fonte['credencial']}_" if fonte.get("credencial") else ""
    usuario = os.getenv(f"{prefixo}DB_USUARIO") or os.getenv("DB_USUARIO", "")
    senha = os.getenv(f"{prefixo}DB_SENHA") or os.getenv("DB_SENHA", "")
    return usuario, senha
