using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace TimeFlow.Data;

// Lets `dotnet ef migrations add ...` build the DbContext without the
// full ASP.NET host. EF Tools calls this factory; we pull the connection
// string from DATABASE_URL or a CLI override.
//
// Usage when generating a migration locally:
//   $env:DATABASE_URL = "Host=localhost;Database=timeflow;Username=timeflow;Password=…"
//   dotnet ef migrations add InitAuth --project backend/TimeFlow.Data --startup-project backend/TimeFlow.Data
public sealed class TimeFlowDbContextFactory : IDesignTimeDbContextFactory<TimeFlowDbContext>
{
    public TimeFlowDbContext CreateDbContext(string[] args)
    {
        var conn = Environment.GetEnvironmentVariable("DATABASE_URL")
            ?? "Host=localhost;Port=5432;Database=timeflow;Username=timeflow;Password=timeflow";
        var options = new DbContextOptionsBuilder<TimeFlowDbContext>()
            .UseNpgsql(conn, npg => npg.MigrationsAssembly(typeof(TimeFlowDbContext).Assembly.GetName().Name))
            .Options;
        return new TimeFlowDbContext(options);
    }
}
