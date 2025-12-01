# PowerShell script to check and fix missing CJ Variant IDs
# Run this from the Workspace directory: .\check-and-fix-vids.ps1

Write-Host "`n🔍 Checking for products with missing CJ Variant IDs...`n" -ForegroundColor Cyan

# Change to backend directory
Set-Location -Path ".\backend"

# Load environment variables from .env file
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
            Write-Host "Loaded env: $key" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "⚠️  No .env file found in backend directory" -ForegroundColor Yellow
}

# Get database connection string
$DATABASE_URL = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")

if (-not $DATABASE_URL) {
    Write-Host "❌ DATABASE_URL not found in environment variables" -ForegroundColor Red
    Write-Host "Please set it in backend/.env file or as an environment variable" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n✅ Database connection found`n" -ForegroundColor Green

# Node.js script to check and fix VIDs
$nodeScript = @'
import('dotenv').then(dotenv => dotenv.config());
import('./src/db.js').then(async (dbModule) => {
  const db = dbModule.default;
  
  try {
    // Check for products missing cj_vid
    const result = await db.query(`
      SELECT id, product_name, cj_pid, cj_vid 
      FROM curated_products 
      WHERE is_active = TRUE 
      AND cj_pid IS NOT NULL 
      AND (cj_vid IS NULL OR cj_vid = '')
      LIMIT 20
    `);
    
    console.log('\n📊 Products Status:\n');
    
    if (result.rows.length === 0) {
      console.log('✅ All active products have cj_vid! No fixes needed.\n');
      
      // Show sample of products with VIDs
      const sample = await db.query(`
        SELECT id, product_name, cj_pid, cj_vid 
        FROM curated_products 
        WHERE is_active = TRUE 
        AND cj_vid IS NOT NULL
        LIMIT 5
      `);
      
      console.log('Sample products with VIDs:');
      sample.rows.forEach(p => {
        console.log(`  ✓ ${p.product_name.substring(0, 40)}`);
        console.log(`    ID: ${p.id}, VID: ${p.cj_vid.substring(0, 20)}...`);
      });
      
      process.exit(0);
    }
    
    console.log(`⚠️  Found ${result.rows.length} products missing cj_vid:\n`);
    
    result.rows.forEach((p, i) => {
      console.log(`${i + 1}. ${p.product_name.substring(0, 50)}`);
      console.log(`   ID: ${p.id}, PID: ${p.cj_pid}, VID: ${p.cj_vid || 'NULL'}\n`);
    });
    
    console.log('\n📝 To fix these products:');
    console.log('   Option 1: Login to admin dashboard and use Product Curation');
    console.log('   Option 2: Manually fetch VIDs from CJ API');
    console.log('   Option 3: Use SQL to update specific products\n');
    
    console.log('Example SQL to fix a product:');
    console.log(`UPDATE curated_products SET cj_vid = 'ACTUAL-VID-FROM-CJ' WHERE id = ${result.rows[0].id};\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
});
'@

Write-Host "Running database check...`n" -ForegroundColor Cyan

# Execute the Node.js script
$nodeScript | node --input-type=module

Set-Location -Path ".."
Write-Host "`n✅ Check complete!`n" -ForegroundColor Green
