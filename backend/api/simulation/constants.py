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

LOW_FUEL_THRESHOLD_MINUTES = 30
FUEL_CRITICAL_THRESHOLD_MINUTES = 12

# --- Aircraft generation ---
INITIAL_FUEL_MINUTES_MEAN = 180
INITIAL_FUEL_MINUTES_STD = 25
INITIAL_FUEL_MINUTES_MIN = 60

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
