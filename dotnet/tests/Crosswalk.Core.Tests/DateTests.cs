using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk.Tests;

public class DateTests
{
    private static readonly OperatorRegistry Registry = OperatorRegistry.Create();

    private static JsonNode? Run(string id, params Value[] args) => ((ValueOperator)Registry.Get(id)!).Run(args).Node;

    [Fact]
    public void TodayIsAUtcDate()
    {
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", Run("date.today")!.GetValue<string>());
        Assert.Equal(DateTime.UtcNow.ToString("yyyy-MM-dd"), Run("date.today")!.GetValue<string>());
    }

    [Fact]
    public void AgreesWithTheCalendarFromYearOneTo9999()
    {
        var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (long days = -719162; days < 2932896; days += 997)
        {
            var date = epoch.AddDays(days);
            var iso = date.ToString("yyyy-MM-dd");
            Assert.Equal(iso, Run("date.add", "1970-01-01", (double)days, "days")!.GetValue<string>());
            Assert.Equal(days, Run("date.diff", "1970-01-01", iso, "days")!.GetValue<double>());
            Assert.Equal(((int)date.DayOfWeek + 6) % 7 + 1, Run("date.part", iso, "weekday")!.GetValue<double>());
        }
    }
}
