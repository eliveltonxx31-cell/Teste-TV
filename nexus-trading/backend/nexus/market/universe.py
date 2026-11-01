"""Tradable universe: liquid US and EUR-denominated European stocks and ETFs.

Europe is limited to EUR venues (Xetra, Euronext Paris/Amsterdam) in v1 so the
only FX conversion required is EUR<->USD. Sectors are static classifications
used for diversification limits.
"""
from __future__ import annotations

from nexus.market.base import Instrument


def _us(t, name, typ, sector, ex="XNYS"):
    return Instrument(symbol=t, ticker=t, name=name, exchange=ex, currency="USD",
                      market="US", asset_type=typ, sector=sector)


def _eu(t, ex, name, typ, sector):
    return Instrument(symbol=f"{t}@{ex}", ticker=t, name=name, exchange=ex, currency="EUR",
                      market="EU", asset_type=typ, sector=sector)


UNIVERSE: list[Instrument] = [
    # --- US ETFs
    _us("SPY", "SPDR S&P 500 ETF", "etf", "Broad Market"),
    _us("QQQ", "Invesco QQQ Trust", "etf", "Broad Market", "XNAS"),
    _us("XLV", "Health Care Select Sector SPDR", "etf", "Health Care"),
    _us("XLP", "Consumer Staples Select Sector SPDR", "etf", "Consumer Staples"),
    _us("XLU", "Utilities Select Sector SPDR", "etf", "Utilities"),
    _us("GLD", "SPDR Gold Shares", "etf", "Commodities"),
    _us("TLT", "iShares 20+ Year Treasury Bond ETF", "etf", "Bonds", "XNAS"),
    # --- US stocks
    _us("AAPL", "Apple Inc.", "stock", "Technology", "XNAS"),
    _us("MSFT", "Microsoft Corp.", "stock", "Technology", "XNAS"),
    _us("NVDA", "NVIDIA Corp.", "stock", "Technology", "XNAS"),
    _us("AMZN", "Amazon.com Inc.", "stock", "Consumer Discretionary", "XNAS"),
    _us("GOOGL", "Alphabet Inc.", "stock", "Communication", "XNAS"),
    _us("JPM", "JPMorgan Chase & Co.", "stock", "Financials"),
    _us("V", "Visa Inc.", "stock", "Financials"),
    _us("JNJ", "Johnson & Johnson", "stock", "Health Care"),
    _us("UNH", "UnitedHealth Group", "stock", "Health Care"),
    _us("PG", "Procter & Gamble", "stock", "Consumer Staples"),
    _us("KO", "Coca-Cola Co.", "stock", "Consumer Staples"),
    _us("COST", "Costco Wholesale", "stock", "Consumer Staples", "XNAS"),
    _us("XOM", "Exxon Mobil", "stock", "Energy"),
    # --- Europe (EUR)
    _eu("SAP", "XETR", "SAP SE", "stock", "Technology"),
    _eu("SIE", "XETR", "Siemens AG", "stock", "Industrials"),
    _eu("ALV", "XETR", "Allianz SE", "stock", "Financials"),
    _eu("DTE", "XETR", "Deutsche Telekom AG", "stock", "Communication"),
    _eu("MC", "XPAR", "LVMH", "stock", "Consumer Discretionary"),
    _eu("OR", "XPAR", "L'Oreal", "stock", "Consumer Staples"),
    _eu("TTE", "XPAR", "TotalEnergies", "stock", "Energy"),
    _eu("ASML", "XAMS", "ASML Holding", "stock", "Technology"),
    _eu("EUNL", "XETR", "iShares Core MSCI World UCITS ETF", "etf", "Broad Market"),
    _eu("EXS1", "XETR", "iShares Core DAX UCITS ETF", "etf", "Broad Market"),
]

BY_SYMBOL = {i.symbol: i for i in UNIVERSE}


def get(symbol: str) -> Instrument:
    return BY_SYMBOL[symbol]
