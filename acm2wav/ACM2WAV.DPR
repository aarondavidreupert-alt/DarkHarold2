{$AppType Console}
// Interplay Fallout ACM to WAV converter
program Acm2Wav;
uses LoadSnd in 'LoadSnd.pas', SysUtils;

{$R ver.res}

var n:string;
begin
   FileMode := 0;
   writeln ('Interplay ACM to WAV converter v1.22, (c) 1999-2001 ABel [TeamX]');
   try
      if paramCount=0 then
      begin
         writeln;
         writeln (' Usage: ACM2WAV acm_file_name [-m]');
         writeln ('    use -m option to produce mono WAV (effects and speech are mono files)');
      end else begin
         inFile := paramstr (1);
         noPath := ExtractFileName (inFile);
         resFile := ChangeFileExt (noPath,'.wav');
         write (' Converting ',inFile,' to ',resFile);
         if UpperCase(ParamStr(2))='-M' then
         begin
            writeln (' (mono)');
            with RiffHeader do
            begin
               nChannels := 1;
               nBlockAlign := 2;
               nAvgBytesPerSec := 22050*2;
            end;
         end else
            writeln;
         n:=inFile+#0;
         LoadSound (@n[1], $e, $10, $c);
         writeln (resLen,' bytes written');
      end;
   except
      on e:Exception do
      begin
         writeln;
         writeln ('Error: ', e.Message);
      end;
   end;
end.