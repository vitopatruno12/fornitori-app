from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AnalyticsPeakSlot(BaseModel):
    weekday: int
    weekday_label: str
    hour: int
    slot_label: str
    avg_amount: Decimal = Decimal("0")
    avg_movimenti: int = 0
    operatori_consigliati: int = 1
    message: str = ""


class AnalyticsCurrentSlot(BaseModel):
    hour: int
    slot_label: str
    operatori_consigliati: int = 1


class AnalyticsSnapshot(BaseModel):
    date: str
    activity: str = "all"
    source: str = "vne"
    lookback_months: int = 3
    incasso_oggi: Decimal = Decimal("0")
    movimenti_oggi: int = 0
    totale_fiscale: Decimal = Decimal("0")
    totale_pos: Decimal = Decimal("0")
    totale_non_fiscale: Decimal = Decimal("0")
    machines: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    data_note: str = ""
    picco_previsto: AnalyticsPeakSlot
    fascia_corrente: AnalyticsCurrentSlot


class AnalyticsSeriesResponse(BaseModel):
    activity: str = "all"
    source: str = "vne"
    total_incasso: Decimal = Decimal("0")
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    weeks: Optional[int] = None
    months: Optional[int] = None
    warnings: List[str] = Field(default_factory=list)
    data_note: str = ""


class AnalyticsHeatCell(BaseModel):
    weekday: int
    weekday_label: str
    hour: int
    slot_label: str
    total_amount: Decimal = Decimal("0")
    avg_amount: Decimal = Decimal("0")
    movimenti: int = 0
    avg_visits: float = 0
    sample_days: int = 0
    intensity: float = 0
    visit_intensity: float = 0
    operatori_consigliati: int = 1
    level: str = "nullo"


class AnalyticsSuggestion(BaseModel):
    weekday_label: str
    slot_label: str
    operatori_consigliati: int
    avg_amount: Decimal = Decimal("0")
    message: str


class AnalyticsHeatmapResponse(BaseModel):
    activity: str = "all"
    source: str = "vne"
    months: int = 3
    hours: List[int]
    weekdays: List[str]
    max_avg_amount: Decimal = Decimal("0")
    max_avg_visits: float = 0
    cells: List[AnalyticsHeatCell]
    suggestions: List[AnalyticsSuggestion]
    machines: List[str] = Field(default_factory=list)
    by_machine: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    data_note: str = ""


class AnalyticsStaffingSlot(BaseModel):
    slot_label: str
    hour: int
    operatori_consigliati: int
    level: str
    avg_amount: Decimal = Decimal("0")
    message: str


class AnalyticsStaffingDay(BaseModel):
    weekday: int
    weekday_label: str
    slots: List[AnalyticsStaffingSlot]
    peak_operators: int = 1


class AnalyticsStaffingResponse(BaseModel):
    activity: str = "all"
    source: str = "vne"
    months: int = 3
    days: List[AnalyticsStaffingDay]
    suggestions: List[AnalyticsSuggestion]
    warnings: List[str] = Field(default_factory=list)
    note: str = ""
    data_note: str = ""


class AnalyticsMachineOverview(BaseModel):
    model_id: str
    model_label: str
    snapshot: AnalyticsSnapshot
    weekly: Dict[str, Any] = Field(default_factory=dict)
    top_slots: List[AnalyticsSuggestion] = Field(default_factory=list)
    hours: List[int] = Field(default_factory=list)
    weekdays: List[str] = Field(default_factory=list)
    cells: List[AnalyticsHeatCell] = Field(default_factory=list)


class AnalyticsOverviewResponse(BaseModel):
    snapshot: AnalyticsSnapshot
    weekly: Dict[str, Any]
    monthly: Dict[str, Any]
    top_slots: List[AnalyticsSuggestion]
    by_machine: List[AnalyticsMachineOverview] = Field(default_factory=list)
    source: str = "vne"
    data_note: str = ""
    warnings: List[str] = Field(default_factory=list)
