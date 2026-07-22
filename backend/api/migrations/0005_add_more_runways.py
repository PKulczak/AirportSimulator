from django.db import migrations

# Two extra runways beyond the 1-10 seeded range, so the master runway list
# exceeds the brief's per-simulation cap of 10 selectable runways — that cap
# is enforced at creation time (SimulationCreationDto.validate_runways),
# not by limiting how many runways exist.
NEW_RUNWAYS = [
    {"identifier": "11", "length_metres": 3300},
    {"identifier": "12", "length_metres": 2700},
]


def add_runways(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")
    for runway in NEW_RUNWAYS:
        Runway.objects.get_or_create(
            identifier=runway["identifier"],
            defaults={
                "heading_degrees": int(runway["identifier"]) * 10,
                "length_metres": runway["length_metres"],
                "is_active": True,
            },
        )


def remove_runways(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")
    Runway.objects.filter(
        identifier__in=[r["identifier"] for r in NEW_RUNWAYS]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0004_renumber_runways"),
    ]

    operations = [
        migrations.RunPython(add_runways, remove_runways),
    ]
