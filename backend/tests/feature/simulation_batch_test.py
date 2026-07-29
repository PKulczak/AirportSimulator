from api.models import Simulation, SimulationBatch
from tests.base_test import BaseFeatureTest


class SimulationBatchTest(BaseFeatureTest):
    def test_batched_simulations_are_retrievable_as_a_group(self):
        batch = SimulationBatch.objects.create()
        batched = self.create_simulations(2, batch=batch)
        self.create_simulations(1)  # not in the batch

        retrieved = Simulation.objects.in_batch(batch.id)

        self.assertEqual(
            {simulation.id for simulation in retrieved},
            {simulation.id for simulation in batched},
        )

    def test_batch_relation_reachable_from_either_side(self):
        batch = SimulationBatch.objects.create()
        simulation = self.create_simulations(1, batch=batch)

        self.assertEqual(simulation.batch_id, batch.id)
        self.assertIn(simulation, batch.simulations.all())

    def test_simulation_without_a_batch_has_none(self):
        simulation = self.create_simulations(1)

        self.assertIsNone(simulation.batch)

    def test_deleting_a_batch_leaves_its_simulations_intact(self):
        batch = SimulationBatch.objects.create()
        simulation = self.create_simulations(1, batch=batch)

        batch.delete()

        simulation.refresh_from_db()
        self.assertIsNone(simulation.batch)
