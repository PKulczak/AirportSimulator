# Airport Modelling — Project Spec

This is the single source of truth for what the simulation should do. It merges the
original client brief (`brief.md`) with the corrections identified against the actual
implementation (`NewChanges.md`), reworded into one coherent description of the target
behaviour. Where the two disagreed, this file describes the *intended* behaviour, not
necessarily what's live in the code today — see **Implementation Status** at the bottom
for what's done vs. still outstanding.

## Purpose

Model aircraft arriving at and departing from a single airport, so an airport operator
can see how different runway configurations, closures, and emergencies affect
throughput. Scope is limited to airplane movement between "entering the airport's
airspace" and "landing", or "receiving take-off clearance" and "taking off" — no gate
assignment, baggage handling, passenger movement, or helicopters.

## How the simulation behaves

### Arrivals and the holding pattern

An aircraft entering the airport's airspace lands immediately if a runway is free;
otherwise it joins the **holding pattern** — a queue of aircraft circling at
staggered altitudes (1000ft vertical separation per aircraft, per real-world holding
procedure) waiting for a landing slot.

Aircraft are selected off the holding pattern in this order:
1. **Emergency** — mechanical failure, low fuel, or passenger health issue declared.
2. **FIFO** — otherwise, whoever joined the holding pattern first.

If no landing slot can be found before the aircraft runs too low on fuel (or exceeds
the configured max wait time), it's **diverted** to another airport.

### Departures and the take-off queue

Aircraft join the back of the take-off queue once cleared for departure. This queue is
**pure FIFO** — unlike the holding pattern, there is no emergency-priority reordering;
the aircraft at the front simply proceeds when a runway slot frees up. If no slot opens
before the max wait time is reached, the flight is **cancelled**.

### Runways

Only one aircraft may occupy a runway (including its approach/departure zone) at a
time. Each runway is configured in one of three modes:
- **Landing only**
- **Take-off only**
- **Mixed** — shared between landing and take-off traffic, dividing availability
  between both queues.

A simulation can use between 1 and 10 runways, each independently configured. Runway
operating mode can be changed as part of the response to a closure (e.g. switching a
closed mixed runway's neighbour to mixed mode to absorb the gap).

Each runway also has an **operational status**, configurable by the user and mutable
during a run: `Available`, `Runway Inspection`, `Snow Clearance`, or
`Equipment Failure`. Random closures (when enabled) pick from these reasons rather than
a generic "closed" flag, so replay/metrics can distinguish *why* a runway went down.

### Scheduling — when aircraft actually show up

Aircraft are scheduled at evenly-spaced target times (`60 / rate_per_hour` minutes
apart, separately for arrivals and departures). The time an aircraft *actually* enters
the model is that target jittered by a Normal distribution (mean 0, std dev 5 minutes),
representing ordinary real-world weather/schedule variability. The clean, un-jittered
target is what "scheduled time" means throughout the system — it's the baseline every
delay metric is measured against.

### Fuel and emergencies

Every aircraft starts with a fuel load, uniformly distributed between **20 and 60
minutes**' worth, consumed at a constant rate regardless of speed, altitude, or
weight. An arrival must land — or be diverted — before its remaining fuel would drop
below **10 minutes**. Low-fuel and fuel-critical warnings escalate its holding-pattern
priority as the deadline approaches.

Mechanical failure and passenger-health emergencies can occur probabilistically to any
queued aircraft, **arrivals only** (departures don't experience in-flight emergencies
while still on the ground) — each escalates the aircraft's priority so it's pulled
toward the front of the holding pattern.

Emergency status is one of: `None`, `Fuel`, `Mechanical Failure`, `Passenger Health`.

### Speed

All aircraft travel at a single, fixed, configurable speed (knots) for the whole
simulation — no per-aircraft speed variation. Descent within the holding pattern is
treated as instantaneous; only final approach/take-off roll consumes runway-occupancy
time.

## Input parameters

| Parameter | Range / notes |
|---|---|
| Available runways | 1–10 |
| Inbound flow (arrivals) | e.g. 15/hour |
| Outbound flow (departures) | e.g. 15/hour |
| Max wait time | Configurable, default 30 minutes — the threshold beyond which an aircraft is diverted/cancelled |
| Aircraft speed | Configurable, single constant across the run |
| Random closures | On/off toggle |

## Data tracked

**Aircraft**: callsign, operator, origin/destination, scheduled vs. actual
arrival/departure time, holding-pattern altitude (derived from queue position, 1000ft
per slot), fuel remaining, emergency status.

**Holding pattern**: the set of arrivals currently queued to land.

**Take-off queue**: the set of departures currently queued to take off.

**Runway**: length (metres), runway number, bearing (degrees), operating mode
(Landing / Take-off / Mixed), operational status (Available / Runway Inspection /
Snow Clearance / Equipment Failure).

Note: aircraft outside the airfield boundary, or stationary on the ground before
joining a queue, aren't represented.

## User controls

- **At creation**: for each runway, its operating mode *and* its initial operational
  status (so a scenario can start with a runway already down for inspection, not just
  rely on random closures during the run).
- **During replay**: play/pause, speed (0.125x–8x), scrub to any point in time, toggle
  the event log.

## Output — in priority order

1. **Departures with a dedicated take-off runway**: variation in take-off timing,
   max/average take-off-queue length, max/average delay between scheduled and actual
   departure time.
2. **Arrivals with a dedicated landing runway**: variation in arrival timing, max/average
   holding-pattern length, max/average delay between scheduled and actual arrival time.
3. **Further runway configurations**: mixed-use and multi-runway setups.
4. **Runway closures**: user-specified closures, and the resulting max number of
   cancellations under a configurable max wait time.
5. **Fuel modelling**: max number of diversions caused by fuel exhaustion in the
   holding pattern.

"Maximum queue length" means **peak concurrent occupancy** (the most aircraft
simultaneously queued at any instant), not an individual aircraft's longest wait —
those are two different numbers and both matter.

## Assumptions & constraints (deliberate simplifications)

- An aircraft exists in exactly one zone at a time: holding pattern, take-off queue, or
  occupying a runway. It doesn't exist in the model before joining a queue or after
  leaving a runway.
- All aircraft travel at one constant, pre-set speed; holding-pattern descent is
  instantaneous.
- Fuel burns at a constant rate, unaffected by speed/altitude/weight.
- Pilots execute perfectly — no human error modelled.
- Not a security-sensitive system.

## Optional / nice-to-have (not required for a working solution)

- Additional statistics beyond max/average (range, variance, percentiles).
- **Real-time replay** of holding pattern and take-off queue — **implemented** as the
  animated visualisation/replay page.
- **Visual representation** of aircraft and queues — **implemented** alongside replay.
- Statistical modelling of runway inspections/mechanical failures/emergencies as
  probabilistic events — **implemented** for aircraft emergencies and runway closures.

## Implementation status

- ✅ **Done**: evenly-spaced scheduling with Gaussian jitter around the target time
  (replacing an earlier Poisson-process approximation).
- ✅ **Done**: uniform(20–60 min) fuel model with a hard 10-minute divert threshold
  (replacing an earlier wider Normal-distributed fuel model).
- 🔲 **Outstanding**: scheduled-vs-actual delay metric on the results/detail page.
- 🔲 **Outstanding**: max concurrent queue depth metric on the results/detail page.
- 🔲 **Outstanding**: runway operational status as a creation-time user control.
- 🔲 **Outstanding**: 4-value operational status enum (currently binary Open/Closed)
  and named closure reasons (currently generic "Random closure" text).
- 🔲 **Outstanding**: restrict priority-escalation/emergency reordering to arrivals only
  (currently also affects the take-off queue).
- 🔲 **Outstanding**: two-digit runway numbering (currently paired-end identifiers like
  "09L/27R") and seeding enough runways to reach the 1–10 range.
