from api.simulation import constants


class PriorityTracker:
    """Tracks an aircraft's current queueing priority.

    `simpy.PriorityResource` treats *lower* numbers as higher priority, so an
    emergency "boosts" priority by *subtracting* from the running score. Scores
    never go below zero.

    SimPy only respects priority at the moment a `.request()` is issued — it
    does not re-sort a request that is already queued. So a boost only reorders
    the queue if the aircraft's pending request(s) are cancelled and reissued
    with the new (lower) score; `SimulationRunner` is responsible for doing
    that reissue when `boost()` returns a new score.
    """

    def __init__(self):
        self.score = float(constants.BASE_PRIORITY)

    def boost(self, event_type):
        amount = constants.EVENT_PRIORITY_BOOSTS.get(event_type, 0)
        self.score = max(0.0, self.score - amount)
        return self.score
