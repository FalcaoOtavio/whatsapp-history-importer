"""Daily sync scheduler.

Fires `bridge.trigger_sync()` once a day at 01:00 America/Sao_Paulo. The hour is
deliberately late: a full history pull is slow and bandwidth-hungry, so it runs
while the machine is most likely idle.

The scheduler class and the timezone are module-level constants so tests can
patch `BackgroundScheduler` without monkeypatching APScheduler itself.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

TIMEZONE = ZoneInfo("America/Sao_Paulo")
SYNC_HOUR = 1
SYNC_MINUTE = 0
JOB_ID = "daily-sync"


def build_trigger(hour: int = SYNC_HOUR, minute: int = SYNC_MINUTE) -> CronTrigger:
    """Cron trigger for `hour:minute` every day, in America/Sao_Paulo."""
    return CronTrigger(hour=hour, minute=minute, timezone=TIMEZONE)


def format_next_run(when: datetime | None) -> str:
    """PT-BR rendering of the next fire time, for the launcher's log line."""
    if when is None:
        return "não agendada"
    local = when.astimezone(TIMEZONE)
    return local.strftime("%d/%m/%Y às %H:%M (%Z)")


class SyncScheduler:
    """Wraps APScheduler with the one job this app needs."""

    def __init__(
        self,
        trigger_sync: Callable[[], object],
        scheduler_factory: Callable[..., BackgroundScheduler] = BackgroundScheduler,
        hour: int = SYNC_HOUR,
        minute: int = SYNC_MINUTE,
    ):
        self._trigger_sync = trigger_sync
        self._scheduler = scheduler_factory(timezone=TIMEZONE)
        self._hour = hour
        self._minute = minute
        self._job = None

    def _run_sync(self) -> None:
        """Job body. Sync failures must not kill the scheduler thread, so they are
        swallowed here — the next day's run will try again."""
        try:
            self._trigger_sync()
        except Exception as exc:  # noqa: BLE001 - see docstring
            print(f"[scheduler] falha ao sincronizar: {exc}")

    def start(self):
        """Register the daily job and start the background scheduler."""
        self._job = self._scheduler.add_job(
            self._run_sync,
            trigger=build_trigger(self._hour, self._minute),
            id=JOB_ID,
            replace_existing=True,
        )
        self._scheduler.start()
        return self._job

    def shutdown(self, wait: bool = False) -> None:
        self._scheduler.shutdown(wait=wait)

    @property
    def next_run_time(self) -> datetime | None:
        job = self._job
        if job is None:
            return None
        # APScheduler >=3.10 exposes next_run_time on the job; a job registered
        # before start() has it as None until the scheduler wakes up.
        return getattr(job, "next_run_time", None)

    def next_run_message(self) -> str:
        return f"Próxima sincronização: {format_next_run(self.next_run_time)}"


def start_scheduler(trigger_sync: Callable[[], object], **kwargs) -> SyncScheduler:
    """Convenience constructor: build, start, and return the scheduler."""
    scheduler = SyncScheduler(trigger_sync, **kwargs)
    scheduler.start()
    return scheduler
