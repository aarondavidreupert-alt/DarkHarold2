unit Procs;
// Expander Procs
//  OpenDecompressor
//  CloseDecompressor
//  ReadDecompressor
//  WriteDecompressor
//  SeekDecompressor
//  TellDecompressor

interface
uses Stream;
type TOpenProc = function (name:PChar; OpenMode: integer): pFileReader;
     TReadProc = function (fr: pFileReader; readBuf: pointer; count: integer): integer;
     TFileLenProc = function (fr: pFileReader):integer;

function OpenDecompressor (name:PChar; OpenMode: integer): pFileReader;
function ReadDecompressor (fr: pFileReader; readBuf: pointer; count: integer): integer;
function FileLenDecompressor (fr: pFileReader):integer;
function TellDecompressor (fr: pFileReader):integer;
function CloseDecompressor (fr: pFileReader):integer;


implementation
uses DictFill;

function OpenDecompressor (name:PChar; OpenMode: integer): pFileReader;
var Compressed:boolean;
    tmpPtr: pFileReader;
begin
   Compressed := true; // Raw data is only in internal version

   new (tmpPtr);
   fillChar (tmpPtr^, sizeOf (tmpPtr^), #0);

   with tmpPtr^ do
   begin
      Flags := 1;
      new (FileVar);
      assignFile (FileVar^, name); reset (FileVar^,1);

      if Compressed then
      begin
         Flags := Flags or 2;
         FileDecompressor := CreateFileDecomp (FileVar, FileSig1, FileSig2, FileLen);
         FileLen := FileLen * 2;
      end
      else
         FileLen := FileSize (FileVar^);
      BytesInReadBuff := 0;
   end;

   result := tmpPtr;
end;

function ReadDecompressor (fr: pFileReader; readBuf: pointer; count: integer): integer;
begin
   with fr^ do
   begin
      if 2 and Flags <> 0 then
         result := ReadAndDecompress (FileDecompressor, readBuf, count)
      else
         blockread (FileVar^, readBuf^, count, result);
      inc (BytesInReadBuff, result);
   end;
end;

function FileLenDecompressor (fr: pFileReader):integer;
begin
   result := fr^. FileLen;
end;

function TellDecompressor (fr: pFileReader):integer;
begin
   result := fr^. BytesInReadBuff;
end;

function CloseDecompressor (fr: pFileReader):integer;
begin
   closeFile(fr^. FileVar^);
end;

end.