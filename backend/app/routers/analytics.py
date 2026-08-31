from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..schemas.analytics import (
    AnalyticsHeatmapResponse,
    AnalyticsOverviewResponse,
    AnalyticsSeriesResponse,
    AnalyticsSnapshot,
    AnalyticsStaffingResponse,
)
from ..services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/snapshot", response_model=AnalyticsSnapshot)
def analytics_snapshot(
    model_id: Optional[str] = Query(None, description="model-1|model-2|model-3 oppure all"),
    location: Optional[str] = Query(None, description="via_zanardelli|via_abba per Mani in Pasta"),
    months: int = Query(3, ge=1, le=6),
    activity: Optional[str] = Query(None, description="Alias legacy di model_id"),
):
    mid = model_id or activity
    try:
        return analytics_service.get_snapshot(model_id=mid, months=months, location=location)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/overview", response_model=AnalyticsOverviewResponse)
def analytics_overview(
    model_id: Optional[str] = Query(None),
    months: int = Query(3, ge=1, le=6),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_overview(model_id=mid, months=months)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/daily", response_model=AnalyticsSeriesResponse)
def analytics_daily(
    days: int = Query(30, ge=7, le=90),
    model_id: Optional[str] = Query(None),
    location: Optional[str] = Query(None, description="via_zanardelli|via_abba per Mani in Pasta"),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_daily_series(days=days, model_id=mid, location=location)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/weekly", response_model=AnalyticsSeriesResponse)
def analytics_weekly(
    weeks: int = Query(12, ge=4, le=26),
    model_id: Optional[str] = Query(None),
    location: Optional[str] = Query(None, description="via_zanardelli|via_abba per Mani in Pasta"),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_weekly_series(weeks=weeks, model_id=mid, location=location)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/monthly", response_model=AnalyticsSeriesResponse)
def analytics_monthly(
    months: int = Query(6, ge=3, le=12),
    model_id: Optional[str] = Query(None),
    location: Optional[str] = Query(None, description="via_zanardelli|via_abba per Mani in Pasta"),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_monthly_series(months=months, model_id=mid, location=location)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/hourly", response_model=AnalyticsHeatmapResponse)
def analytics_hourly(
    months: int = Query(3, ge=1, le=6),
    model_id: Optional[str] = Query(None),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_hourly_heatmap(months=months, model_id=mid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e


@router.get("/staffing", response_model=AnalyticsStaffingResponse)
def analytics_staffing(
    months: int = Query(3, ge=1, le=6),
    model_id: Optional[str] = Query(None),
    activity: Optional[str] = Query(None),
):
    mid = model_id or activity
    try:
        return analytics_service.get_staffing_plan(months=months, model_id=mid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analisi VNE non disponibile: {e}") from e
