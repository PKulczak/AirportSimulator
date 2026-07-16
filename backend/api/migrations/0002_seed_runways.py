from django.db import migrations

RUNWAYS = [
    {"identifier": "09L/27R", "heading_degrees": 90, "length_metres": 3600},
    {"identifier": "09R/27L", "heading_degrees": 90, "length_metres": 3200},
    {"identifier": "05/23", "heading_degrees": 50, "length_metres": 2800},
    {"identifier": "14/32", "heading_degrees": 140, "length_metres": 3000},
    {"identifier": "01/19", "heading_degrees": 10, "length_metres": 2500},
    {"identifier": "16/34", "heading_degrees": 160, "length_metres": 3400},
]


def seed_runways(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")
    for runway in RUNWAYS:
        Runway.objects.get_or_create(
            identifier=runway["identifier"],
            defaults={
                "heading_degrees": runway["heading_degrees"],
                "length_metres": runway["length_metres"],
                "is_active": True,
            },
        )


def unseed_runways(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")
    Runway.objects.filter(
        identifier__in=[runway["identifier"] for runway in RUNWAYS]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_runways, unseed_runways),
    ]
