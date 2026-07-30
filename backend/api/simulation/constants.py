"""Tunable constants for the simulation engine.

None of these are exposed as `Simulation` model fields — they represent
engine-internal behaviour (how often emergencies/closures fire, how big a
priority boost each emergency type grants, etc.) rather than user-configured
scenario parameters.
"""

# --- Priority ---
# simpy.PriorityResource treats *lower* numbers as higher priority.
BASE_PRIORITY = 100

EVENT_PRIORITY_BOOSTS = {
    "LowFuel": 10,
    "FuelCritical": 40,
    "MechanicalFailure": 25,
    "PassengerHealth": 15,
}

# --- Emergency events (arrivals only — see the take-off queue's pure-FIFO
# rule; departures never roll for or receive any of these) ---
# Mechanical failure and passenger health are each rolled once per arriving
# aircraft, independently of one another and of the fuel-based warnings below,
# and declared immediately on joining the holding pattern — not at a random
# later point, which could land after the aircraft is already assigned a
# runway and silently never fire, pulling the realized rate below this figure.
MECHANICAL_FAILURE_PROBABILITY = 0.05
PASSENGER_HEALTH_PROBABILITY = 0.05

# --- Aircraft generation ---
# Fuel is uniformly distributed 20-60 minutes' worth; an arrival must land
# (or be diverted) before remaining fuel would drop below the reserve below.
INITIAL_FUEL_MINUTES_MIN = 20
INITIAL_FUEL_MINUTES_MAX = 60
FORCED_DIVERT_FUEL_REMAINING_MINUTES = 10

# Fuel warnings fire at fixed absolute remaining-fuel checkpoints (not a
# fraction of some derived budget) so they're a simple, verifiable rule: this
# many minutes of fuel left, full stop. LowFuel fires 10 minutes before the
# forced-divert reserve above; FuelCritical splits the gap between the two,
# giving a clear three-stage escalation as remaining fuel runs down:
# LowFuel (20 min left) -> FuelCritical (15 min left) -> forced divert (10 min left).
LOW_FUEL_REMAINING_MINUTES = 20
FUEL_CRITICAL_REMAINING_MINUTES = 15

# Aircraft are scheduled at evenly-spaced target times (60 / rate_per_hour
# minutes apart); the actual time they enter the model is jittered around
# that target by Normal(0, this-many-minutes), per the brief's assumption
# that real-world weather/delays perturb arrival/departure timing.
TARGET_TIME_JITTER_STD_MINUTES = 5

# --- Runway operation ---
# Nominal runway-occupancy time (minutes) for a single arrival/departure
# operation at the configured aircraft speed; faster aircraft occupy the
# runway for less time.
REFERENCE_SPEED_KNOTS = 140
REFERENCE_OPERATION_MINUTES = 6.0
MIN_OPERATION_MINUTES = 2.0

# --- Aircraft weight class / wake separation ---
# Default Heavy/Medium/Light traffic mix (percent, sums to 100) used when a
# Simulation doesn't override it via heavy_percentage/medium_percentage/
# light_percentage — a typical scheduled-service airport: mostly Medium
# (single-aisle jets), a modest share of Heavy (wide-bodies/freighters), and a
# minority of Light (regional/GA) traffic.
DEFAULT_WEIGHT_CLASS_MIX_PERCENTAGES = {"Heavy": 10, "Medium": 75, "Light": 15}

# Extra minutes a runway must stay occupied by the *trailing* operation on top
# of its own base (speed-scaled) occupancy time, keyed by
# (leading aircraft's weight class, trailing aircraft's weight class) —
# approximates real-world ICAO wake-turbulence separation minima (normally
# expressed as a landing/departure distance, not time) as a flat extra buffer
# in this engine's minutes-based model. A Heavy generates the most wake and
# most affects a Light follower; Light aircraft generate negligible wake, so
# nothing needs extra separation behind one. Any pair not listed (e.g. no
# leading operation yet) needs no extra separation.
WAKE_SEPARATION_EXTRA_MINUTES = {
    ("Heavy", "Heavy"): 0.0,
    ("Heavy", "Medium"): 1.5,
    ("Heavy", "Light"): 3.0,
    ("Medium", "Heavy"): 0.0,
    ("Medium", "Medium"): 0.0,
    ("Medium", "Light"): 1.0,
    ("Light", "Heavy"): 0.0,
    ("Light", "Medium"): 0.0,
    ("Light", "Light"): 0.0,
}

# --- Runway closures (only scheduled when Simulation.include_closures) ---
CLOSURE_MEAN_INTERVAL_MINUTES = 45.0
CLOSURE_MEAN_DURATION_MINUTES = 12.0
CLOSURE_MIN_DURATION_MINUTES = 3.0

# --- Cancellation ---
# How often (in sim-minutes) the runner re-reads Simulation.cancel_requested
# from the DB to decide whether to abort. Small enough to stay responsive on a
# long run, large enough that a normal run only issues a handful of extra
# lightweight PK reads. Also the cadence at which the same watchdog bumps
# Simulation.last_heartbeat_at (see below) — a cancel-check tick already
# proves the process is alive, so it doubles as the liveness signal.
CANCELLATION_POLL_MINUTES = 5.0

# --- Stalled-run detection ---
# Real/wall-clock minutes (unlike every other constant in this file, which is
# sim-minutes) a Running simulation can go without a heartbeat update before
# `check_stalled_simulations` considers its worker dead/hung and marks it
# Error. Generous relative to how long a run actually takes in practice
# (documented in CLAUDE.md as ~10s wall-clock even for a large run),
# specifically so a slow-but-genuinely-alive run is never mistaken for a
# stalled one.
STALLED_RUN_TIMEOUT_REAL_MINUTES = 30.0

# --- Floating point safety ---
# `remaining = deadline - elapsed` can converge to a value too small, relative
# to env.now's magnitude, for float64 addition to actually advance the clock
# (e.g. env.now=37.7 + 1e-15 rounds right back to 37.7). Treating anything at
# or below this epsilon as "expired" prevents a zero-progress infinite loop.
TIME_EPSILON_MINUTES = 1e-6
