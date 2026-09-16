from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

from launcher.scheduler import (
    JOB_ID,
    SYNC_HOUR,
    SYNC_MINUTE,
    TIMEZONE,
    SyncScheduler,
    build_trigger,
    format_next_run,
    start_scheduler,
)

SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def test_timezone_is_sao_paulo():
    assert TIMEZONE == SAO_PAULO


def test_trigger_fires_at_0100_sao_paulo():
    trigger = build_trigger()

    # Ask the trigger what comes next after midnight local time — it should be
    # 01:00 the same day.
    previous = datetime(2026, 3, 10, 0, 0, tzinfo=SAO_PAULO)
    next_fire = trigger.get_next_fire_time(None, previous)

    assert next_fire.hour == SYNC_HOUR
    assert next_fire.minute == SYNC_MINUTE
    assert next_fire.date() == previous.date()


def test_trigger_rolls_to_tomorrow_when_already_past():
    trigger = build_trigger()

    previous = datetime(2026, 3, 10, 9, 30, tzinfo=SAO_PAULO)
    next_fire = trigger.get_next_fire_time(None, previous)

    assert next_fire.hour == SYNC_HOUR
    assert next_fire.day == 11


def test_start_registers_daily_job_and_starts_scheduler():
    fake_scheduler = MagicMock()
    factory = MagicMock(return_value=fake_scheduler)
    trigger_sync = MagicMock()

    scheduler = SyncScheduler(trigger_sync, scheduler_factory=factory)
    scheduler.start()

    factory.assert_called_once_with(timezone=TIMEZONE)
    fake_scheduler.add_job.assert_called_once()
    _, kwargs = fake_scheduler.add_job.call_args
    assert kwargs["id"] == JOB_ID
    assert kwargs["replace_existing"] is True
    fake_scheduler.start.assert_called_once()


def test_job_body_calls_trigger_sync():
    fake_scheduler = MagicMock()
    trigger_sync = MagicMock(return_value={"status": "started"})

    scheduler = SyncScheduler(trigger_sync, scheduler_factory=MagicMock(return_value=fake_scheduler))
    scheduler.start()

    # The callable APScheduler was handed is the job body — invoke it directly
    # to assert it reaches the bridge.
    job_body = fake_scheduler.add_job.call_args[0][0]
    job_body()

    trigger_sync.assert_called_once_with()


def test_sync_failure_does_not_propagate():
    fake_scheduler = MagicMock()
    trigger_sync = MagicMock(side_effect=RuntimeError("sidecar offline"))

    scheduler = SyncScheduler(trigger_sync, scheduler_factory=MagicMock(return_value=fake_scheduler))
    scheduler.start()
    job_body = fake_scheduler.add_job.call_args[0][0]

    job_body()  # must not raise — the scheduler thread has to survive

    trigger_sync.assert_called_once()


def test_shutdown_delegates_to_scheduler():
    fake_scheduler = MagicMock()
    scheduler = SyncScheduler(MagicMock(), scheduler_factory=MagicMock(return_value=fake_scheduler))
    scheduler.start()
    scheduler.shutdown()

    fake_scheduler.shutdown.assert_called_once_with(wait=False)


def test_format_next_run_is_ptbr_and_localized():
    when = datetime(2026, 3, 11, 1, 0, tzinfo=SAO_PAULO)
    assert format_next_run(when).startswith("11/03/2026 às 01:00")


def test_format_next_run_handles_none():
    assert format_next_run(None) == "não agendada"


def test_next_run_message_uses_ptbr_prefix():
    fake_job = MagicMock()
    fake_job.next_run_time = datetime(2026, 3, 11, 1, 0, tzinfo=SAO_PAULO)
    fake_scheduler = MagicMock()
    fake_scheduler.add_job.return_value = fake_job

    scheduler = SyncScheduler(MagicMock(), scheduler_factory=MagicMock(return_value=fake_scheduler))
    scheduler.start()

    message = scheduler.next_run_message()
    assert message.startswith("Próxima sincronização: ")
    assert "11/03/2026 às 01:00" in message


def test_start_scheduler_helper_starts_and_returns():
    fake_scheduler = MagicMock()
    trigger_sync = MagicMock()

    scheduler = start_scheduler(trigger_sync, scheduler_factory=MagicMock(return_value=fake_scheduler))

    assert isinstance(scheduler, SyncScheduler)
    fake_scheduler.start.assert_called_once()
