using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/octet-stream" });
});

var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.UseWebAssemblyDebugging();
}

void ApplyHeaders(IHeaderDictionary headers)
{
    headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
}

app.Use(async (context, next) =>
{
    ApplyHeaders(context.Response.Headers);
    await next();
});

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
else
{
    app.UseDeveloperExceptionPage();
}

app.UseHttpsRedirection();
app.UseResponseCompression();

app.UseBlazorFrameworkFiles();
////app.UseStaticFiles(new StaticFileOptions
////{
////    ServeUnknownFileTypes = true,
////});
var contentTypeProvider = new FileExtensionContentTypeProvider();
var evergineExtensions = new[] { ".weptx", ".wepsn", ".wepsc", ".wepsp", ".weprl", ".weprp", ".weppp", ".wepmd", ".wepmt", ".wepfb", ".wepfx", ".wepprf" };
foreach (var evergineExtension in evergineExtensions)
{
    contentTypeProvider.Mappings.Add(evergineExtension, "application/octet-stream");
}
app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true,
    ContentTypeProvider = contentTypeProvider
});

app.UseRouting();


app.MapRazorPages();
//app.MapControllers();
app.MapFallbackToFile("index.html");

app.Run();
