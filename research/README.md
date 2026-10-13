# Offline lifecycle replay

Research code only. Production selection thresholds are unchanged.
Supply private `input/signals.json` and `input/chips.json` locally; no private dataset is published in this branch.
The replay uses historical proxy entry signals, and is not a validated replay of original production models.

Run `python research/test_replay.py` and `python research/replay.py` with Python 3 and pandas installed.
Production validation still requires original model snapshots, exact rule versions, corporate actions, executable prices, point-in-time raw chip features, and portfolio allocation rules.
The two-line discovery correction in `scan-discovery-v40.patch` is deployed to asheng-scan-bridge v40; it caps exploration at three and prioritizes oldest attempts while preserving existing budgets and schedules.
