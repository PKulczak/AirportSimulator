from django.db import migrations

# Maps each existing (realistic, paired-end) seeded identifier to its new
# simple two-digit number. Renumbering in place (rather than delete+recreate)
# keeps every runway's PK stable, so existing SimulationRunway/Aircraft FK
# references are untouched — only the display identifier/heading change.
RENUMBER = {
    "09L/27R": "01",
    "09R/27L": "02",
    "05/23": "03",
    "14/32": "04",
    "01/19": "05",
    "16/34": "06",
}

# New runways added to bring the seeded total up to 10, matching the brief's
# 1-10 available-runways range.
NEW_RUNWAYS = [
    {"identifier": "07", "length_metres": 2600},
    {"identifier": "08", "length_metres": 3100},
    {"identifier": "09", "length_metres": 3500},
    {"identifier": "10", "length_metres": 2900},
]


def renumber_runways(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")

    for old_identifier, new_identifier in RENUMBER.items():
        Runway.objects.filter(identifier=old_identifier).update(
            identifier=new_identifier,
            heading_degrees=int(new_identifier) * 10,
        )

    for runway in NEW_RUNWAYS:
        Runway.objects.get_or_create(
            identifier=runway["identifier"],
            defaults={
                "heading_degrees": int(runway["identifier"]) * 10,
                "length_metres": runway["length_metres"],
                "is_active": True,
            },
        )


def revert_renumbering(apps, schema_editor):
    Runway = apps.get_model("api", "Runway")

    Runway.objects.filter(
        identifier__in=[r["identifier"] for r in NEW_RUNWAYS]
    ).delete()

    original_heading = {
        "09L/27R": 90,
        "09R/27L": 90,
        "05/23": 50,
        "14/32": 140,
        "01/19": 10,
        "16/34": 160,
    }
    for old_identifier, new_identifier in RENUMBER.items():
        Runway.objects.filter(identifier=new_identifier).update(
            identifier=old_identifier,
            heading_degrees=original_heading[old_identifier],
        )


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0003_update_operational_status_enum"),
    ]

    operations = [
        migrations.RunPython(renumber_runways, revert_renumbering),
    ]
