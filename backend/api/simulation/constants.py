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

# --- Emergency events ---
# Every this-many (simulated) minutes while an aircraft is queued, roll the dice
# on firing an emergency event for it.
EMERGENCY_EVENT_CHECK_INTERVAL_MINUTES = 3
EMERGENCY_EVENT_PROBABILITY_PER_CHECK = 0.08

MECHANICAL_FAILURE_PROBABILITY_WEIGHT = 0.3
PASSENGER_HEALTH_PROBABILITY_WEIGHT = 0.3
# Remaining weight goes to fuel-related events, which are only rolled for
# Arrival aircraft (departures don't run out of fuel waiting at the gate).

# Fixed-minute-before-deadline offsets don't scale down to the fuel range
# below (a fixed 30-minute warning would already be "in the past" for an
# aircraft with only a 10-minute total wait-tolerance budget). Warnings are
# fractions of the wait-tolerance budget instead, so they always land in
# order no matter how tight an individual aircraft's fuel is.
LOW_FUEL_THRESHOLD_FRACTION = 0.5  # fires at 50% of budget elapsed
FUEL_CRITICAL_THRESHOLD_FRACTION = 0.8  # fires at 80% of budget elapsed (20% remaining)

# --- Aircraft generation ---
# Fuel is uniformly distributed 20-60 minutes' worth; an arrival must land
# (or be diverted) before remaining fuel would drop below the reserve below.
INITIAL_FUEL_MINUTES_MIN = 20
INITIAL_FUEL_MINUTES_MAX = 60
FORCED_DIVERT_FUEL_REMAINING_MINUTES = 10

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

# --- Runway closures (only scheduled when Simulation.include_closures) ---
CLOSURE_MEAN_INTERVAL_MINUTES = 45.0
CLOSURE_MEAN_DURATION_MINUTES = 12.0
CLOSURE_MIN_DURATION_MINUTES = 3.0

# --- Floating point safety ---
# `remaining = deadline - elapsed` can converge to a value too small, relative
# to env.now's magnitude, for float64 addition to actually advance the clock
# (e.g. env.now=37.7 + 1e-15 rounds right back to 37.7). Treating anything at
# or below this epsilon as "expired" prevents a zero-progress infinite loop.
TIME_EPSILON_MINUTES = 1e-6
